import {
  JobState, SceneCard, PipelineStage, ApprovalStatus, AssetType,
  ShotType, CameraMotion, TransitionType, SeriesConfig,
} from "../types";
import { callClaudeJSON } from "../modules/claude/client";
import { buildSceneAnnotationSystemPrompt, buildSceneAnnotationUserPrompt } from "../prompts/scenes";
import { segmentScript, Segment } from "../utils/sentence-split";
import { ACTIVE_SERIES } from "../config/series";
import { saveJob } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";

const ANNOTATE_BATCH = 25;

interface Annotation {
  i: number;
  shot_type?: string;
  mood?: string;
  location?: string;
  character_refs?: string[];
  is_symbolic_insert?: boolean;
  sfx_prompt?: string;
  dialogue_text?: string;
  dialogue_side?: "left" | "right";
}

export async function splitIntoScenes(state: JobState): Promise<SceneCard[]> {
  if (!state.brief || !state.outline || !state.script) {
    throw new Error("Brief, outline, and script required before scene splitting");
  }
  const series = state.series ?? ACTIVE_SERIES;

  // 1) Deterministic sentence-level segmentation with MIN(merge)/MAX(split) guardrails.
  logger.step("scenes", "Segmenting script into sentence-level scenes...");
  let segments = segmentScript(state.script.full_text, {
    wordsPerMinute: config.wordsPerMinute,
    minSec:         config.minSceneDurationSec,
    maxSec:         config.maxSceneDurationSec,
  });

  // Cap to MAX_SCENES by merging the shortest adjacent pairs (rare for 9–12 min).
  segments = capSegments(segments, config.maxScenes, config.wordsPerMinute);
  logger.info("scenes", `${segments.length} segments (target ${config.minScenes}–${config.maxScenes})`);

  // 2) Annotate segments with shot_type / mood / location / character_refs (Claude, batched).
  const annotations = await annotate(state, segments, series);

  // 3) Build scene cards (timing is provisional here; real spans assigned in voiceover).
  let cursor = 0;
  const scenes: SceneCard[] = segments.map((seg, i) => {
    const a = annotations.get(i);
    const shot_type = a?.shot_type ? normaliseShotType(a.shot_type) : rotateShot(i, seg.is_insert);
    const start = cursor;
    cursor += seg.est_duration_sec;
    return {
      scene_id:            `s${String(i + 1).padStart(3, "0")}`,
      scene_index:         i,
      outline_section_ref: "",
      start_time_estimate: round1(start),
      duration_estimate:   seg.est_duration_sec,
      start_sec:           round1(start),
      end_sec:             round1(cursor),
      duration_sec:        seg.est_duration_sec,
      is_insert:           seg.is_insert,
      narration_text:      seg.text,
      subtitle_text:       seg.text,
      shot_type,
      location:            a?.location ?? "",
      mood:                a?.mood ?? "",
      character_refs:      a?.character_refs ?? [series.protagonist.id],
      character_prompt:    "",
      placement_note:      "",
      is_symbolic_insert:  a?.is_symbolic_insert ?? (shot_type === ShotType.SymbolicInsert),
      sfx_prompt:          a?.sfx_prompt ?? "",
      dialogue_text:       (a?.dialogue_text ?? "").trim(),
      dialogue_side:       a?.dialogue_side === "right" ? "right" : "left",
      visual_prompt:       "",
      style_tags:          [],
      negative_prompt:     "",
      camera_motion:       defaultMotionFor(shot_type),
      transition_type:     TransitionType.FadeBlack,
      sound_design_notes:  "",
      asset_type:          AssetType.Still,
      priority:            3,
      approval_status:     ApprovalStatus.Pending,
    };
  });

  // Enforce the close-up budget the annotation was asked for (LLMs overshoot): never two
  // close-ups in a row, and at most ~22% of all scenes. Excess close-ups become two_shots
  // (when two leads are present) or establishing shots.
  rebalanceCloseUps(scenes);

  // First-appearance labels (webcomic device): "23" over the POV lead, names over side characters.
  applyOverlayLabels(scenes, series, state.script.full_text);

  state.scenes    = scenes;
  state.stage     = PipelineStage.Scened;
  await saveJob(state);

  const totalEst = scenes.reduce((s, sc) => s + sc.duration_estimate, 0);
  const inserts  = scenes.filter(s => s.is_insert).length;
  const bubbles  = scenes.filter(s => s.dialogue_text).length;
  logger.success("scenes", `${scenes.length} scenes (~${(totalEst / 60).toFixed(1)} min est, ${inserts} inserts, ${bubbles} dialogue bubbles)`);
  return scenes;
}

/**
 * Deterministic close-up budget (no LLM): the annotation prompt asks for ≤1-in-4 close-ups
 * but models overshoot. Pass 1 breaks up consecutive close-ups; pass 2 caps the global share
 * at ~22%, demoting the excess (keeping every ~Nth so the strongest rhythm survives).
 */
function rebalanceCloseUps(scenes: SceneCard[]): void {
  const demote = (s: SceneCard) => {
    s.shot_type     = s.character_refs.length >= 2 ? ShotType.TwoShot : ShotType.Establishing;
    s.camera_motion = defaultMotionFor(s.shot_type);
  };

  // Pass 1: no two close-ups back-to-back.
  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i].shot_type === ShotType.CloseUp && scenes[i - 1].shot_type === ShotType.CloseUp) {
      demote(scenes[i]);
    }
  }

  // Pass 2: global cap ~22% — keep an evenly-spaced subset, demote the rest.
  const cap     = Math.max(1, Math.floor(scenes.length * 0.22));
  const closeUps = scenes.filter(s => s.shot_type === ShotType.CloseUp);
  if (closeUps.length > cap) {
    const keepEvery = closeUps.length / cap;
    closeUps.forEach((s, idx) => {
      if (Math.floor(idx % keepEvery) !== 0) demote(s);
    });
    logger.info("scenes", `Close-up budget: ${closeUps.length} → ${scenes.filter(s => s.shot_type === ShotType.CloseUp).length} (cap ${cap})`);
  }
}

/**
 * Deterministic first-appearance labels (no LLM): the POV lead gets his age (parsed from
 * "You're 23" / "You are 23" in the script) on his first scene; each side character gets
 * their name on their first scene. Sides are approximate — the arrow points at the general
 * area, matching the reference video's "23 ↘" device.
 */
function applyOverlayLabels(scenes: SceneCard[], series: SeriesConfig, scriptText: string): void {
  const labelled = new Set<string>();

  // POV age from the script's cold open.
  const ageMatch = scriptText.match(/\byou(?:'re| are)\s+(\d{1,3})\b/i);
  const povLabel = ageMatch ? ageMatch[1] : "";

  for (const scene of scenes) {
    for (const id of scene.character_refs) {
      if (labelled.has(id)) continue;
      let text = "";
      let side: "left" | "right" = "right";

      if (id === series.protagonist.id) {
        if (!povLabel) { labelled.add(id); continue; }   // no age stated — skip labelling "You"
        text = povLabel;
        side = scene.dialogue_side === "left" ? "right" : "left";  // opposite the speaker if any
      } else {
        const char = series.characters.find(c => c.id === id);
        if (!char) continue;
        text = char.name;
        side = scene.dialogue_side ?? "right";
      }

      labelled.add(id);
      scene.overlay_labels = [...(scene.overlay_labels ?? []), { text, side }];
    }
  }
}

// ─── ANNOTATION ─────────────────────────────────────────────────────────────

async function annotate(state: JobState, segments: Segment[], series: SeriesConfig): Promise<Map<number, Annotation>> {
  const map = new Map<number, Annotation>();
  const system = buildSceneAnnotationSystemPrompt(series, config.protagonistDetailed);

  for (let i = 0; i < segments.length; i += ANNOTATE_BATCH) {
    const batch = segments.slice(i, i + ANNOTATE_BATCH).map((seg, j) => ({ i: i + j, text: seg.text }));
    try {
      const { data, costUsd } = await callClaudeJSON<{ items: Annotation[] }>(
        system, buildSceneAnnotationUserPrompt(batch), 4000, `scene-annotate-${i / ANNOTATE_BATCH}`
      );
      state.cost_usd += costUsd;
      for (const item of data.items ?? []) {
        if (typeof item.i === "number") map.set(item.i, item);
      }
    } catch (err) {
      logger.warn("scenes", `Annotation batch ${i}-${i + batch.length} failed (${(err as Error).message}); using deterministic defaults`);
    }
  }
  return map;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function capSegments(segments: Segment[], maxScenes: number, wpm: number): Segment[] {
  const segs = [...segments];
  while (segs.length > maxScenes) {
    // Find adjacent pair with smallest combined duration and merge it.
    let bestIdx = 0;
    let bestDur = Infinity;
    for (let i = 0; i < segs.length - 1; i++) {
      const d = segs[i].est_duration_sec + segs[i + 1].est_duration_sec;
      if (d < bestDur) { bestDur = d; bestIdx = i; }
    }
    const a = segs[bestIdx];
    const b = segs[bestIdx + 1];
    const text = `${a.text} ${b.text}`;
    segs.splice(bestIdx, 2, {
      text,
      est_duration_sec: Math.round((text.trim().split(/\s+/).length / wpm) * 60 * 10) / 10,
      is_insert: a.is_insert && b.is_insert,
    });
  }
  return segs;
}

const SHOT_ROTATION = [ShotType.Establishing, ShotType.TwoShot, ShotType.CloseUp, ShotType.DetailInsert];
function rotateShot(index: number, isInsert: boolean): ShotType {
  if (isInsert) return ShotType.DetailInsert;
  return SHOT_ROTATION[index % SHOT_ROTATION.length];
}

function normaliseShotType(value: unknown): ShotType {
  const v = String(value ?? "").toLowerCase();
  const all = Object.values(ShotType) as string[];
  return (all.includes(v) ? v : ShotType.Establishing) as ShotType;
}

function defaultMotionFor(shot: ShotType): CameraMotion {
  switch (shot) {
    case ShotType.Establishing:   return CameraMotion.SlowZoomIn;
    // Close-ups zoom OUT: zooming IN on an already-tight face crops the head mid-shot.
    case ShotType.CloseUp:        return CameraMotion.SlowZoomOut;
    case ShotType.TwoShot:        return CameraMotion.PanRight;
    case ShotType.DetailInsert:   return CameraMotion.KenBurns;
    case ShotType.SymbolicInsert: return CameraMotion.SlowZoomOut;
    default:                      return CameraMotion.SlowZoomIn;
  }
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
