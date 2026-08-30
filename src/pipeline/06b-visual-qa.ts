/**
 * VISUAL QA-AND-SELECT (Master Brief Part 9 — the "self-correcting loop").
 * For each scene: score the generated variant(s) with a vision LLM against the style
 * anchor and (if present) the character reference sheet, pick the best, and auto-retry
 * scenes that score below the minimum. Turns "bad image gen" into a recoverable step.
 */
import path from "path";
import {
  JobState, SceneCard, PipelineStage, AssetType, SeriesConfig, CharacterRole,
} from "../types";
import { callClaudeVisionJSON } from "../modules/claude/client";
import { getImageProvider } from "../modules/imagegen";
import { ACTIVE_SERIES } from "../config/series";
import { saveJob, jobDir } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";

interface VariantScore { index: number; score: number; issues: string }

export async function selectVisuals(state: JobState): Promise<SceneCard[]> {
  if (!state.scenes) throw new Error("Scenes required before visual QA");
  const scenes = [...state.scenes];

  // Pass-through when QA is disabled — keep the pipeline linear.
  if (!config.visualQa) {
    state.stage = PipelineStage.VisualSelected;
    await saveJob(state);
    logger.info("visual-qa", "VISUAL_QA disabled — keeping first variant per scene");
    return scenes;
  }

  const series   = state.series ?? ACTIVE_SERIES;
  const provider = getImageProvider();
  const assetsDir = path.join(jobDir(state.job_id), "assets");
  logger.step("visual-qa", "Scoring variants and selecting best per scene...");

  let retries = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene    = scenes[i];
    const variants = scene.variant_urls ?? (scene.asset_url ? [scene.asset_url] : []);
    if (variants.length === 0) continue;   // placeholder / manifest-pending scene

    const refSheets = resolveReferenceSheets(scene, series);
    let best = await scoreVariants(state, scene, variants, series, refSheets, i);

    // Auto-retry once if the best variant is below threshold.
    if (best.score < config.visualQaMinScore && retries < scenes.length) {
      logger.warn("visual-qa", `Scene ${scene.scene_id} best score ${best.score}/10 — regenerating once`);
      retries++;
      const filename = `scene_${String(scene.scene_index + 1).padStart(3, "0")}_retry`;
      try {
        const req = { prompt: scene.visual_prompt, negative: scene.negative_prompt, referenceImagePaths: refSheets, outputDir: assetsDir, filename };
        const isChar = refSheets.length > 0 || hasLead(scene, series);
        const result = isChar ? await provider.generateCharacterScene(req) : await provider.generateBackground(req);
        state.cost_usd += result.costUsd;
        if (result.imagePath) {
          const retryVariants = [...variants, result.imagePath];
          best = await scoreVariants(state, scene, retryVariants, series, refSheets, i);
          scenes[i] = { ...scene, variant_urls: retryVariants };
        }
      } catch (err) {
        logger.warn("visual-qa", `Retry failed for ${scene.scene_id}: ${(err as Error).message}`);
      }
    }

    const chosen = (scenes[i].variant_urls ?? variants)[best.index] ?? variants[0];
    scenes[i] = {
      ...scenes[i],
      asset_url:  chosen,
      asset_type: AssetType.Still,
      qa_score:   best.score,
      qa_notes:   best.issues,
    };
    logger.info("visual-qa", `Scene ${scene.scene_id}: picked variant ${best.index + 1} (${best.score}/10)`);
  }

  state.scenes = scenes;
  state.stage  = PipelineStage.VisualSelected;
  await saveJob(state);

  const avg = scenes.filter(s => s.qa_score != null).reduce((a, s) => a + (s.qa_score ?? 0), 0) /
              Math.max(1, scenes.filter(s => s.qa_score != null).length);
  logger.success("visual-qa", `Selection complete — avg score ${avg.toFixed(1)}/10, ${retries} retries`);
  return scenes;
}

async function scoreVariants(
  state: JobState,
  scene: SceneCard,
  variants: string[],
  series: SeriesConfig,
  refSheets: string[],
  sceneIdx: number
): Promise<VariantScore> {
  // Build a vision request: reference sheets first (if any), then the variants.
  const images = [...refSheets, ...variants];
  const refNote = refSheets.length > 0
    ? `The first ${refSheets.length} image(s) are character reference sheets. The remaining ${variants.length} are candidate scenes. Check every lead is ON-MODEL (same face, hair, clothing, proportions as their sheet) and that non-lead figures are pure black silhouettes.`
    : `The images are candidate scenes for this beat.`;

  const system = `You are an art director QA'ing generated frames for a POV animation channel.
STYLE ANCHOR: ${series.style_anchor}
PALETTE: ${series.palette_grade}
Score each candidate 0–10 on: style-anchor match, composition for a "${scene.shot_type}" shot, mood "${scene.mood}", and (if a reference sheet is given) character fidelity. Penalise HARD: heads cropped at the hairline/chin, faces cut off by the frame edge, faces filling the whole frame with no headroom, wrong style, extra fingers/limbs, garbled faces, text/speech bubbles/watermarks baked into the image, off-palette.
Respond ONLY with JSON: {"scores":[{"index":0,"score":7,"issues":"..."}]} where index is 0-based over the CANDIDATE images only.`;

  const user = `Scene ${scene.scene_id} [${scene.shot_type}] — location: ${scene.location}; mood: ${scene.mood}.
${refNote}
Intended image: ${scene.visual_prompt.substring(0, 300)}`;

  try {
    const { data, costUsd } = await callClaudeVisionJSON<{ scores: VariantScore[] }>(
      system, user, images, 700, `visual-qa-${sceneIdx}`
    );
    state.cost_usd += costUsd;
    const scores = (data.scores ?? []).filter(s => typeof s.score === "number");
    if (scores.length === 0) return { index: 0, score: config.visualQaMinScore, issues: "no score returned" };
    return scores.reduce((best, s) => (s.score > best.score ? s : best), scores[0]);
  } catch (err) {
    logger.warn("visual-qa", `Scoring failed for ${scene.scene_id}: ${(err as Error).message}`);
    return { index: 0, score: config.visualQaMinScore, issues: "scoring error — kept first variant" };
  }
}

function hasLead(scene: SceneCard, series: SeriesConfig): boolean {
  const ids = new Set([
    series.protagonist.id,
    ...series.characters.filter(c => c.role === CharacterRole.Detailed).map(c => c.id),
  ]);
  return scene.character_refs.some(id => ids.has(id));
}

/** Collect the reference sheets of EVERY lead present in the scene (POV first, then sides). */
function resolveReferenceSheets(scene: SceneCard, series: SeriesConfig): string[] {
  const sheets: string[] = [];
  if (scene.character_refs.includes(series.protagonist.id) && series.protagonist.reference_sheet_url) {
    sheets.push(series.protagonist.reference_sheet_url);
  }
  for (const id of scene.character_refs) {
    const char = series.characters.find(c => c.id === id && c.role === CharacterRole.Detailed);
    if (char?.reference_sheet_url) sheets.push(char.reference_sheet_url);
  }
  return sheets;
}
