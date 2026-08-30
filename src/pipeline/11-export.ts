/**
 * Export stage — generates the final publishing package:
 * SRT subtitles, YouTube metadata, chapter timestamps, thumbnail prompts.
 */
import path from "path";
import { v4 as uuid } from "uuid";
import fs from "fs-extra";
import {
  JobState, VideoPackage, ChapterTimestamp, PipelineStage,
} from "../types";
import { callClaudeJSON } from "../modules/claude/client";
import { buildExportMetaPrompt } from "../prompts/export";
import { saveJob, jobDir } from "../utils/job-store";
import { logger } from "../utils/logger";

export async function exportPackage(state: JobState): Promise<VideoPackage> {
  if (!state.brief || !state.classification || !state.script || !state.outline || !state.scenes) {
    throw new Error("Brief, classification, script, outline, and scenes required before export");
  }

  logger.step("export", "Generating publishing package...");

  const dir = jobDir(state.job_id);

  // ── 1. Generate SRT subtitle file ────────────────────────────────────
  const srtPath = path.join(dir, "subtitles.srt");
  await generateSRT(state, srtPath);

  // ── 1b. Manual-editing guide: where to add speech bubbles + labels ───
  await generateBubbleGuide(state, path.join(dir, "bubble_guide.txt"));

  // ── 2. Generate YouTube metadata via Claude ──────────────────────────
  const metaPrompt = buildExportMetaPrompt(
    state.brief,
    state.classification,
    state.script,
    state.outline
  );

  const { data, costUsd } = await callClaudeJSON<{
    title_options: string[];
    description: string;
    tags: string[];
    thumbnail_prompts: string[];
    chapter_timestamps: ChapterTimestamp[];
  }>(
    "You are a YouTube SEO strategist. Respond only with valid JSON.",
    metaPrompt,
    4096,
    "export-meta"
  );

  state.cost_usd += costUsd;

  // ── 3. Write metadata files ──────────────────────────────────────────
  await fs.writeJson(path.join(dir, "youtube_meta.json"), data, { spaces: 2 });

  // Write description as plain text too (easier for copy-paste)
  await fs.writeFile(path.join(dir, "description.txt"), data.description);

  // Write chapter timestamps in YouTube format
  const chaptersText = (data.chapter_timestamps ?? [])
    .map(c => `${c.display} ${c.label}`)
    .join("\n");
  await fs.writeFile(path.join(dir, "chapters.txt"), chaptersText);

  // ── 4. Assemble the video package ────────────────────────────────────
  const pkg: VideoPackage = {
    package_id:         uuid(),
    job_id:             state.job_id,
    mp4_path:           state.render_url ?? path.join(dir, "draft_render.mp4"),
    srt_path:           srtPath,
    thumbnail_prompts:  data.thumbnail_prompts ?? [],
    title_options:      data.title_options ?? [],
    description:        data.description ?? "",
    chapter_timestamps: data.chapter_timestamps ?? [],
    tags:               data.tags ?? [],
    created_at:         new Date().toISOString(),
  };

  state.video_package = pkg;
  state.stage         = PipelineStage.Exported;
  await saveJob(state);

  logger.success("export", `Package ready — ${pkg.title_options.length} title options, SRT at ${srtPath}`);
  return pkg;
}

// ─── SRT GENERATION ──────────────────────────────────────────────────────────

async function generateSRT(state: JobState, outputPath: string): Promise<void> {
  const scenes = state.scenes ?? [];
  const lines: string[] = [];
  let index = 1;

  // One subtitle per scene/sentence, using the real audio timestamps (no drift).
  for (const scene of scenes) {
    const start = scene.start_sec ?? scene.start_time_estimate;
    const end   = scene.end_sec   ?? (start + (scene.duration_sec ?? scene.duration_estimate));
    const text  = (scene.subtitle_text || scene.narration_text || "").replace(/\n/g, " ").trim();
    if (!text) continue;

    lines.push(String(index));
    lines.push(`${formatSRTTime(start)} --> ${formatSRTTime(end)}`);
    lines.push(text);
    lines.push("");
    index++;
  }

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
  logger.success("export", `SRT generated: ${index - 1} subtitle entries`);
}

/**
 * Manual-editing guide for CapCut: every scene that needs a speech bubble or a
 * first-appearance label, with exact timestamps, side, and text. Bubbles are added
 * by hand (Shotstack's HTML renderer garbles styled text), so this file is the map.
 */
async function generateBubbleGuide(state: JobState, outputPath: string): Promise<void> {
  const scenes = state.scenes ?? [];
  const lines: string[] = [
    "MANUAL OVERLAY GUIDE — speech bubbles & labels",
    `Job: ${state.job_id}   Topic: ${state.topic_input.topic}`,
    "Add these in CapCut on top of draft_render.mp4. Times are video timestamps.",
    "",
    "── SPEECH BUBBLES ──",
  ];

  let n = 0;
  for (const s of scenes) {
    const text = (s.dialogue_text ?? "").trim();
    if (!text) continue;
    n++;
    const start = s.start_sec ?? s.start_time_estimate;
    const end   = s.end_sec ?? (start + (s.duration_sec ?? s.duration_estimate));
    lines.push(
      `${String(n).padStart(2)}. ${fmtTime(start)}–${fmtTime(end)}  [speaker on ${s.dialogue_side ?? "left"}]  scene ${s.scene_id} (${s.location || "?"})`,
      `    "${text}"`,
      ""
    );
  }
  if (n === 0) lines.push("(none — no quoted dialogue in this script)", "");

  lines.push("── FIRST-APPEARANCE LABELS (name/age + small arrow) ──");
  let m = 0;
  for (const s of scenes) {
    for (const l of s.overlay_labels ?? []) {
      m++;
      const start = s.start_sec ?? s.start_time_estimate;
      lines.push(`${String(m).padStart(2)}. at ${fmtTime(start)}  label "${l.text}" pointing at character on ${l.side}  (scene ${s.scene_id})`);
    }
  }
  if (m === 0) lines.push("(none)");

  await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
  logger.success("export", `Bubble guide: ${n} bubbles, ${m} labels → ${path.basename(outputPath)}`);
}

function fmtTime(sec: number): string {
  const mm = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function formatSRTTime(seconds: number): string {
  const h   = Math.floor(seconds / 3600);
  const m   = Math.floor((seconds % 3600) / 60);
  const s   = Math.floor(seconds % 60);
  const ms  = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }
function pad3(n: number): string { return String(n).padStart(3, "0"); }
