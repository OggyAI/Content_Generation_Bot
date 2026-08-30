import path from "path";
import { v4 as uuid } from "uuid";
import {
  JobState, RenderPlan, RenderTrack, RenderClip,
  AssetManifest, SceneAsset, AssetType, PipelineStage,
  TransitionType
} from "../types";
import { saveJob, jobDir } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";
import { ACTIVE_SERIES } from "../config/series";
import { SeriesLane } from "../types";

export async function buildTimeline(state: JobState): Promise<RenderPlan> {
  if (!state.scenes || !state.voice_chunks) {
    throw new Error("Scenes and voice chunks required before timeline");
  }

  logger.step("timeline", "Assembling render timeline...");

  const scenes = state.scenes;
  const chunks = state.voice_chunks;

  // Each scene carries its real audio span [start_sec, end_sec] from the voiceover stage.
  // Fall back to a cumulative WPM estimate only if timing is missing (legacy jobs).
  let fallbackCursor = 0;
  const sceneTimings = scenes.map((scene): { start: number; length: number } => {
    if (scene.start_sec != null && scene.duration_sec != null) {
      return { start: scene.start_sec, length: scene.duration_sec };
    }
    const length = scene.duration_estimate || 3;
    const start  = fallbackCursor;
    fallbackCursor += length;
    return { start, length };
  });

  // ─── VIDEO TRACK ───────────────────────────────────────────────────────────
  // Each image sits at exactly its sentence's audio window → visual tracks the words.
  // RENDER_GRADE=none (default) keeps the AI images' own palette — stacking Shotstack's
  // crude filters on already-graded images was muddying the look.
  const lane = (state.series ?? ACTIVE_SERIES).lane;
  const videoClips: RenderClip[] = scenes.map((scene, i) => ({
    clip_id:    `vc_${scene.scene_id}`,
    scene_id:   scene.scene_id,
    asset_url:  scene.asset_url ?? PLACEHOLDER_IMAGE_URL,
    start:      round2(sceneTimings[i].start),
    length:     round2(sceneTimings[i].length),
    effect:     scene.camera_motion,
    filter:     config.renderGrade === "auto" ? moodToFilter(lane, scene.mood) : undefined,
    transition: scene.transition_type,
  }));

  // ─── SUBTITLE TRACK (optional — reference style runs clean, SRT exported anyway) ──
  const subtitleClips: RenderClip[] = !config.subtitlesEnabled ? [] : scenes.flatMap((scene, i) => {
    const text = (scene.subtitle_text || "").replace(/\n/g, " ").trim();
    if (!text) return [];
    return [{
      clip_id:       `sub_${scene.scene_id}`,
      scene_id:      scene.scene_id,
      asset_url:     "",
      start:         round2(sceneTimings[i].start),
      length:        round2(sceneTimings[i].length),
      subtitle_text: text,
      html_kind:     "subtitle" as const,
      opacity:       1,
    }];
  });

  // ─── COMIC OVERLAYS (webcomic style) ───────────────────────────────────────
  // Speech bubbles: one per scene with dialogue, spanning the scene window, offset to the
  // speaker's side. Labels ("23", "Jack"): first ~2.5s of a lead's first appearance.
  // Separate tracks — clips within one Shotstack track cannot overlap in time.
  const bubbleClips: RenderClip[] = !config.bubblesEnabled ? [] : scenes.flatMap((scene, i) => {
    const text = (scene.dialogue_text ?? "").trim();
    if (!text) return [];
    return [{
      clip_id:       `bub_${scene.scene_id}`,
      scene_id:      scene.scene_id,
      asset_url:     "",
      start:         round2(sceneTimings[i].start),
      length:        round2(sceneTimings[i].length),
      subtitle_text: text,
      html_kind:     "bubble" as const,
      offset_x:      scene.dialogue_side === "right" ? 0.22 : -0.22,
      offset_y:      -0.06,
      opacity:       1,
    }];
  });

  const labelClips: RenderClip[] = !config.labelsEnabled ? [] : scenes.flatMap((scene, i) => {
    const labels = scene.overlay_labels ?? [];
    return labels.slice(0, 1).map(l => ({    // one label per scene keeps the track overlap-free
      clip_id:       `lab_${scene.scene_id}`,
      scene_id:      scene.scene_id,
      asset_url:     "",
      start:         round2(sceneTimings[i].start),
      length:        round2(Math.min(2.5, sceneTimings[i].length)),
      subtitle_text: l.text,
      html_kind:     "label" as const,
      offset_x:      l.side === "right" ? 0.28 : -0.28,
      offset_y:      -0.12,
      opacity:       1,
    }));
  });

  // ─── NARRATION AUDIO TRACK ─────────────────────────────────────────────────
  // Sequential batch audio files placed at their global offsets (drift-free).
  const narrationClips: RenderClip[] = chunks.map(chunk => ({
    clip_id:   `na_${chunk.chunk_id}`,
    scene_id:  chunk.scene_id,
    asset_url: chunk.audio_url ?? "",
    start:     round2(chunk.start_offset_sec ?? 0),
    length:    round2(chunk.duration_sec ?? 0),
  }));

  const lastSceneEnd = sceneTimings.reduce((m, t) => Math.max(m, t.start + t.length), 0);
  const lastAudioEnd = chunks.reduce((m, c) => Math.max(m, (c.start_offset_sec ?? 0) + (c.duration_sec ?? 0)), 0);
  const totalDuration = Math.max(lastSceneEnd, lastAudioEnd);

  // ─── SFX TRACK (selective, scene-matched, low volume) ──────────────────────
  const sfxClips: RenderClip[] = scenes
    .map((scene, i) => ({ scene, i }))
    .filter(({ scene }) => !!scene.sfx_url)
    .map(({ scene, i }) => ({
      clip_id:   `sfx_${scene.scene_id}`,
      scene_id:  scene.scene_id,
      asset_url: scene.sfx_url!,
      start:     round2(sceneTimings[i].start),
      length:    round2(Math.min(sceneTimings[i].length, 12)),
    }));

  const tracks: RenderTrack[] = [
    { track_type: "video",            clips: videoClips },
    { track_type: "audio_narration",  clips: narrationClips },
  ];
  if (subtitleClips.length > 0) tracks.push({ track_type: "subtitle",       clips: subtitleClips });
  if (bubbleClips.length > 0)   tracks.push({ track_type: "overlay_bubble", clips: bubbleClips });
  if (labelClips.length > 0)    tracks.push({ track_type: "overlay_label",  clips: labelClips });
  if (sfxClips.length > 0)      tracks.push({ track_type: "audio_sfx",      clips: sfxClips });

  const renderPlan: RenderPlan = {
    render_plan_id: uuid(),
    job_id:         state.job_id,
    total_duration: totalDuration,
    tracks,
    output_format:  "mp4",
    resolution:     "hd",
    fps:            config.renderFps,
    created_at:     new Date().toISOString(),
  };

  // ─── ASSET MANIFEST ────────────────────────────────────────────────────────
  const manifest: AssetManifest = {
    manifest_id: uuid(),
    job_id:      state.job_id,
    scenes:      scenes.map(s => ({
      scene_id:   s.scene_id,
      asset_type: s.asset_type,
      asset_url:  s.asset_url ?? "",
      width:      1344,
      height:     768,
      cached:     false,
    })),
    created_at:  new Date().toISOString(),
  };

  state.render_plan    = renderPlan;
  state.asset_manifest = manifest;
  state.stage          = PipelineStage.Timed;
  await saveJob(state);

  logger.success("timeline", `Timeline: ${scenes.length} clips, ${(totalDuration / 60).toFixed(1)} min`);
  return renderPlan;
}

const PLACEHOLDER_IMAGE_URL =
  "https://via.placeholder.com/1344x768/1a1a1a/ffffff?text=Asset+Pending";

function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Map the series lane + per-scene mood to a Shotstack colour-grade filter
 * (Master Brief Part 3.2 — warm = intimacy, cold = loss, neon = nightlife).
 */
function moodToFilter(lane: SeriesLane, mood: string): string | undefined {
  const m = (mood ?? "").toLowerCase();
  if (/loss|cold|grief|distance|empty|alone|fear|dread/.test(m)) return "muted";
  if (/neon|night|club|nightlife|electric/.test(m))              return "contrast";
  if (/warm|intima|love|tender|hope|home/.test(m))               return "boost";

  // Lane default grade when the mood doesn't match a keyword.
  return lane === SeriesLane.DesaturatedGrim ? "muted" : "boost";
}
