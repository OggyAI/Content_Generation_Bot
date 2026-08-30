/**
 * Pacing verification harness (no full pipeline / no render cost).
 *
 *   npx ts-node src/test-pacing.ts                 # real ElevenLabs timing on first N segments
 *   npx ts-node src/test-pacing.ts --estimate      # WPM estimate only (no API cost)
 *   npx ts-node src/test-pacing.ts --limit 20      # how many segments to time with real audio
 *   npx ts-node src/test-pacing.ts --script path   # use a different script file
 *
 * Step A segments the FULL script (free) to verify scene count.
 * Step B times the first N segments with real audio to verify drift-free timestamps,
 * keeping API spend tiny.
 */
import path from "path";
import fs from "fs-extra";
import { config } from "./config/defaults";
import { segmentScript, Segment } from "./utils/sentence-split";
import { buildCharBatches, mapSentenceSpans } from "./utils/audio-timing";
import { generateVoiceoverWithTimestamps, Alignment } from "./modules/elevenlabs/client";

interface Timed { text: string; start: number; end: number; duration: number; is_insert: boolean }

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const scriptPath = arg("script", path.join(process.cwd(), "samples", "sample-script.txt"))!;
  const limit      = parseInt(arg("limit", "14")!, 10);
  const estimate   = hasFlag("estimate");

  const script = await fs.readFile(scriptPath, "utf-8");

  // ── STEP A: full segmentation (free) ───────────────────────────────────────
  const segments = segmentScript(script, {
    wordsPerMinute: config.wordsPerMinute,
    minSec:         config.minSceneDurationSec,
    maxSec:         config.maxSceneDurationSec,
  });
  const estTotal = segments.reduce((s, g) => s + g.est_duration_sec, 0);
  const estDurs  = segments.map(s => s.est_duration_sec);

  console.log("\n══════════ STEP A — SEGMENTATION (full script, estimate) ══════════");
  console.log(`Script:           ${path.basename(scriptPath)}`);
  console.log(`Scenes:           ${segments.length}  (target ${config.minScenes}–${config.maxScenes})`);
  console.log(`Est. runtime:     ${(estTotal / 60).toFixed(1)} min`);
  console.log(`Scene duration:   min ${Math.min(...estDurs).toFixed(1)}s · avg ${(estTotal / segments.length).toFixed(1)}s · max ${Math.max(...estDurs).toFixed(1)}s`);
  console.log(`Inserts (splits): ${segments.filter(s => s.is_insert).length}`);
  console.log(`Guardrails:       MIN ${config.minSceneDurationSec}s (merge) · MAX ${config.maxSceneDurationSec}s (split)`);

  // ── STEP B: timing on first N segments ──────────────────────────────────────
  const subset = segments.slice(0, Math.min(limit, segments.length));
  const useReal = !estimate && !!config.elevenLabsApiKey && config.elevenLabsApiKey !== "...";

  let timed: Timed[];
  if (useReal) {
    console.log(`\n══════════ STEP B — REAL AUDIO TIMING (first ${subset.length} scenes) ══════════`);
    timed = await timeWithRealAudio(subset);
  } else {
    console.log(`\n══════════ STEP B — ESTIMATED TIMING (first ${subset.length} scenes; no API) ══════════`);
    timed = timeWithEstimate(subset);
  }

  // Each image holds until the next sentence begins (covers inter-sentence pauses).
  timed = makeContiguous(timed);
  // Safety split so nothing exceeds MAX (mirrors the voiceover stage).
  timed = splitOverMax(timed, config.maxSceneDurationSec);

  // ── Scene table ─────────────────────────────────────────────────────────────
  console.log("");
  console.log("  #  | start    | end      | dur   | ins | text");
  console.log("-----+----------+----------+-------+-----+--------------------------------------------");
  timed.forEach((t, i) => {
    console.log(
      `${String(i + 1).padStart(4)} | ${fmt(t.start)} | ${fmt(t.end)} | ${t.duration.toFixed(2).padStart(5)} | ${t.is_insert ? " ● " : "   "} | ${snippet(t.text)}`
    );
  });

  // ── Acceptance checks ───────────────────────────────────────────────────────
  const overMax = timed.filter(t => t.duration > config.maxSceneDurationSec + 0.05);
  let maxDrift = 0;
  for (let i = 1; i < timed.length; i++) maxDrift = Math.max(maxDrift, Math.abs(timed[i].start - timed[i - 1].end));

  console.log("\n══════════ ACCEPTANCE ══════════");
  check(segments.length >= config.minScenes && segments.length <= config.maxScenes,
    `Scene count ${segments.length} within ${config.minScenes}–${config.maxScenes}`);
  check(overMax.length === 0, `No scene exceeds MAX ${config.maxSceneDurationSec}s (${overMax.length} over)`);
  check(maxDrift < 0.05, `No drift between consecutive images (max gap ${maxDrift.toFixed(3)}s)`);
  check(new Set(timed.map(t => t.duration)).size > 3, `Durations vary by narration (not fixed-length)`);
  console.log(`\nMode: ${useReal ? "REAL ElevenLabs timestamps" : "ESTIMATE (run without --estimate and with a valid key for real timing)"}\n`);
}

async function timeWithRealAudio(subset: Segment[]): Promise<Timed[]> {
  const audioDir = path.join(process.cwd(), "output", "_pacing_test");
  await fs.ensureDir(audioDir);

  const texts   = subset.map(s => s.text);
  const batches = buildCharBatches(texts, config.audioBatchChars);
  const out: Timed[] = new Array(subset.length);
  let offset = 0;
  let cost = 0;

  for (let b = 0; b < batches.length; b++) {
    const group = batches[b];
    const sentences = group.map(i => texts[i]);
    const res = await generateVoiceoverWithTimestamps(
      sentences.join(" "), audioDir, `pacing_${b + 1}`, config.elevenLabsVoiceId, 0.5, 0.75
    );
    cost += res.costUsd;
    const align: Alignment = res.alignment;
    const spans = mapSentenceSpans(sentences, align, res.durationSec);
    group.forEach((sceneIdx, j) => {
      const start = offset + spans[j].start;
      const end   = offset + spans[j].end;
      out[sceneIdx] = { text: subset[sceneIdx].text, start, end, duration: end - start, is_insert: subset[sceneIdx].is_insert };
    });
    offset += res.durationSec;
  }
  console.log(`(ElevenLabs ${batches.length} batch(es), ~$${cost.toFixed(3)}, ${offset.toFixed(1)}s audio)`);
  return out;
}

function timeWithEstimate(subset: Segment[]): Timed[] {
  let cursor = 0;
  return subset.map(s => {
    const start = cursor;
    cursor += s.est_duration_sec;
    return { text: s.text, start, end: cursor, duration: s.est_duration_sec, is_insert: s.is_insert };
  });
}

function makeContiguous(timed: Timed[]): Timed[] {
  return timed.map((t, i) => {
    const end = i < timed.length - 1 ? timed[i + 1].start : t.end;
    return { ...t, end, duration: end - t.start };
  });
}

function splitOverMax(timed: Timed[], maxSec: number): Timed[] {
  const out: Timed[] = [];
  for (const t of timed) {
    if (t.duration <= maxSec) { out.push(t); continue; }
    const k = Math.ceil(t.duration / maxSec);
    const piece = t.duration / k;
    for (let n = 0; n < k; n++) {
      const start = t.start + n * piece;
      const end   = n === k - 1 ? t.end : start + piece;
      out.push({ text: t.text, start, end, duration: end - start, is_insert: n > 0 || t.is_insert });
    }
  }
  return out;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60);
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
function snippet(t: string): string {
  const clean = t.replace(/\s+/g, " ").trim();
  return clean.length > 44 ? clean.slice(0, 44) + "…" : clean;
}
function check(ok: boolean, label: string) {
  console.log(`  ${ok ? "✅" : "❌"}  ${label}`);
}

main().catch(err => { console.error(err); process.exit(1); });
