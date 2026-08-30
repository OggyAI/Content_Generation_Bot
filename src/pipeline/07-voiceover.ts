import path from "path";
import { v4 as uuid } from "uuid";
import { JobState, VoiceChunk, SceneCard, PipelineStage, ShotType } from "../types";
import { generateVoiceoverWithTimestamps, generateSoundEffect, Alignment } from "../modules/elevenlabs/client";
import { alignWithWhisperX } from "../modules/whisperx/align";
import { buildCharBatches, mapSentenceSpans } from "../utils/audio-timing";
import { saveJob, jobDir } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";

export async function generateVoiceovers(state: JobState): Promise<VoiceChunk[]> {
  if (!state.scenes || state.scenes.length === 0) throw new Error("Scenes required before voiceover");

  const audioDir = path.join(jobDir(state.job_id), "audio");
  const scenes   = [...state.scenes];
  const texts    = scenes.map(s => s.narration_text.trim());

  // Batch sentences under the per-request character limit (stitched sequentially).
  const batches = buildCharBatches(texts, config.audioBatchChars);
  logger.step("voiceover", `Generating timed narration: ${scenes.length} sentences in ${batches.length} batch(es)`);

  const chunks: VoiceChunk[] = [];
  let globalOffset = 0;

  for (let b = 0; b < batches.length; b++) {
    const group         = batches[b];
    const batchSentences = group.map(i => texts[i]);
    const batchText      = batchSentences.join(" ");

    const result = await generateVoiceoverWithTimestamps(
      batchText, audioDir, `voice_batch_${String(b + 1).padStart(2, "0")}`,
      config.elevenLabsVoiceId, 0.50, 0.75
    );

    // Resolve alignment: ElevenLabs timestamps → whisperX (if enabled) → proportional.
    let alignment: Alignment = result.alignment;
    if (alignment.chars.length === 0 && config.useWhisperX) {
      try { alignment = await alignWithWhisperX(result.audioPath); }
      catch (err) { logger.warn("voiceover", `whisperX fallback failed: ${(err as Error).message}`); }
    }
    if (alignment.chars.length === 0) {
      logger.warn("voiceover", `Batch ${b + 1}: no timestamps — using proportional timing`);
    }

    const spans = mapSentenceSpans(batchSentences, alignment, result.durationSec);

    group.forEach((sceneIdx, j) => {
      const start = globalOffset + spans[j].start;
      const end   = globalOffset + spans[j].end;
      scenes[sceneIdx] = {
        ...scenes[sceneIdx],
        start_sec:           round1(start),
        end_sec:             round1(end),
        duration_sec:        round1(end - start),
        start_time_estimate: round1(start),     // keep legacy fields in sync
        duration_estimate:   round1(end - start),
      };
    });

    chunks.push({
      chunk_id:         uuid(),
      scene_id:         `batch_${b + 1}`,
      scene_index:      b,
      text:             batchText,
      audio_url:        result.audioPath,
      duration_sec:     round1(result.durationSec),
      start_offset_sec: round1(globalOffset),
      voice_id:         config.elevenLabsVoiceId,
      model_id:         config.elevenLabsModelId,
      stability:        0.50,
      similarity:       0.75,
      generated_at:     new Date().toISOString(),
      cost_usd:         result.costUsd,
    });

    state.cost_usd += result.costUsd;
    globalOffset   += result.durationSec;
    logger.info("voiceover", `Batch ${b + 1}: ${result.durationSec.toFixed(1)}s${result.cached ? " (cached)" : ""}`);
  }

  // Make image windows contiguous: each image holds until the NEXT sentence begins,
  // covering ElevenLabs' natural inter-sentence pauses — no gaps, no drift on the video track.
  for (let i = 0; i < scenes.length - 1; i++) {
    const a = scenes[i], next = scenes[i + 1];
    if (a.start_sec != null && next.start_sec != null) {
      scenes[i] = { ...a, end_sec: next.start_sec, duration_sec: round1(next.start_sec - a.start_sec), duration_estimate: round1(next.start_sec - a.start_sec) };
    }
  }
  const last = scenes[scenes.length - 1];
  if (last?.start_sec != null) {
    scenes[scenes.length - 1] = { ...last, end_sec: round1(globalOffset), duration_sec: round1(globalOffset - last.start_sec), duration_estimate: round1(globalOffset - last.start_sec) };
  }

  // Safety guardrail for runaway scenes only. We split at a HIGHER threshold than MAX so a
  // normal long sentence just holds one image a little longer instead of cloning it into an
  // awkward back-to-back repeat (segmentation already splits genuinely long sentences into
  // distinct wide+insert images).
  const finalScenes = splitOverMax(scenes, config.maxSceneDurationSec * 1.7);

  // Generate selective, scene-matched sound effects (layered low under narration at render).
  if (config.sfxEnabled) {
    const sfxDir = path.join(jobDir(state.job_id), "sfx");
    let sfxCount = 0;
    for (const scene of finalScenes) {
      const prompt = (scene.sfx_prompt ?? "").trim();
      if (!prompt) continue;
      try {
        const dur = scene.duration_sec ?? scene.duration_estimate ?? 4;
        const r = await generateSoundEffect(prompt, dur, sfxDir, `sfx_${String(scene.scene_index + 1).padStart(3, "0")}`);
        scene.sfx_url = r.audioPath;
        state.cost_usd += r.costUsd;
        sfxCount++;
      } catch (err) {
        logger.warn("voiceover", `SFX failed for scene ${scene.scene_id}: ${(err as Error).message}`);
      }
    }
    if (sfxCount > 0) logger.success("voiceover", `${sfxCount} scene-matched sound effects generated`);
  }

  state.scenes       = finalScenes;
  state.voice_chunks = chunks;
  state.stage        = PipelineStage.Voiced;
  await saveJob(state);

  const over = finalScenes.filter(s => (s.duration_sec ?? 0) > config.maxSceneDurationSec).length;
  logger.success("voiceover",
    `${finalScenes.length} scenes timed, ${(globalOffset / 60).toFixed(1)} min audio` +
    (over > 0 ? ` — WARNING ${over} still over MAX` : ` — all ≤ ${config.maxSceneDurationSec}s`));
  return chunks;
}

/**
 * Split any scene whose REAL audio span exceeds maxSec into equal sub-windows that
 * reuse the same image (kept ≤ maxSec). Inserts carry no subtitle to avoid duplication.
 * Re-indexes scenes afterwards.
 */
function splitOverMax(scenes: SceneCard[], maxSec: number): SceneCard[] {
  const out: SceneCard[] = [];

  for (const scene of scenes) {
    const dur = scene.duration_sec ?? 0;
    if (dur <= maxSec || !scene.start_sec || !scene.end_sec) {
      out.push(scene);
      continue;
    }

    const k     = Math.ceil(dur / maxSec);
    const piece = dur / k;
    for (let n = 0; n < k; n++) {
      const start = scene.start_sec + n * piece;
      const end   = n === k - 1 ? scene.end_sec : start + piece;
      out.push({
        ...scene,
        scene_id:      n === 0 ? scene.scene_id : `${scene.scene_id}_i${n}`,
        start_sec:     round1(start),
        end_sec:       round1(end),
        duration_sec:  round1(end - start),
        start_time_estimate: round1(start),
        duration_estimate:   round1(end - start),
        is_insert:     n === 0 ? scene.is_insert : true,
        subtitle_text: n === 0 ? scene.subtitle_text : "",
        shot_type:     n === 0 ? scene.shot_type : ShotType.DetailInsert,
      });
    }
  }

  return out.map((s, i) => ({ ...s, scene_index: i }));
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
