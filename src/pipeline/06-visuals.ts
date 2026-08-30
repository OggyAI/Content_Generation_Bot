import path from "path";
import {
  JobState, SceneCard, AssetType, PipelineStage, SeriesConfig, CharacterRole,
} from "../types";
import { callClaudeJSON } from "../modules/claude/client";
import { buildVisualDesignSystemPrompt, buildVisualDesignUserPrompt } from "../prompts/visuals";
import { getImageProvider, GenResult } from "../modules/imagegen";
import { ACTIVE_SERIES } from "../config/series";
import { saveJob, jobDir } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";

const BATCH_SIZE = 5; // Claude prompt-design batch size

export async function generateVisuals(state: JobState): Promise<SceneCard[]> {
  if (!state.brief || !state.scenes) {
    throw new Error("Brief and scenes required before visuals");
  }

  const series   = state.series ?? ACTIVE_SERIES;
  const provider = getImageProvider();
  logger.step("visuals", `Designing prompts + generating assets (backbone: ${provider.name})`);

  const scenes        = state.scenes;
  const assetsDir     = path.join(jobDir(state.job_id), "assets");
  const updatedScenes = [...scenes];

  // ── Step 1: design vivid, series-locked prompts via Claude (batched) ──────────
  for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
    const batch = scenes.slice(i, i + BATCH_SIZE);
    const { data, costUsd } = await callClaudeJSON<{ scenes: Array<{ scene_id: string; visual_prompt: string; negative_prompt: string }> }>(
      buildVisualDesignSystemPrompt(series),
      buildVisualDesignUserPrompt(batch, series),
      3000,
      `visuals-design-batch-${Math.floor(i / BATCH_SIZE)}`
    );
    state.cost_usd += costUsd;

    for (const r of data.scenes ?? []) {
      const idx = updatedScenes.findIndex(s => s.scene_id === r.scene_id);
      if (idx >= 0) {
        updatedScenes[idx] = {
          ...updatedScenes[idx],
          visual_prompt:   r.visual_prompt   ?? updatedScenes[idx].visual_prompt,
          negative_prompt: r.negative_prompt ?? updatedScenes[idx].negative_prompt,
        };
      }
    }
    logger.info("visuals", `Prompts designed for scenes ${i}–${Math.min(i + BATCH_SIZE, scenes.length) - 1}`);
  }

  // ── Step 2: generate image variants per scene ─────────────────────────────────
  const nVariants  = config.visualQa ? Math.max(1, config.variantsPerScene) : 1;
  let pendingCount = 0;

  for (let i = 0; i < updatedScenes.length; i++) {
    const scene    = updatedScenes[i];
    const baseName = `scene_${String(scene.scene_index + 1).padStart(3, "0")}`;
    const refSheets = resolveReferenceSheets(scene, series);
    const isCharacterScene = refSheets.length > 0 || hasLead(scene, series);

    const variants: string[] = [];
    try {
      for (let v = 0; v < nVariants; v++) {
        const filename = nVariants > 1 ? `${baseName}_v${v + 1}` : baseName;
        const req = {
          prompt:              scene.visual_prompt,
          negative:            scene.negative_prompt,
          referenceImagePaths: refSheets,
          outputDir:           assetsDir,
          filename,
        };

        const result: GenResult = isCharacterScene
          ? await provider.generateCharacterScene(req)
          : await provider.generateBackground(req);

        state.cost_usd += result.costUsd;

        if (result.pending) { pendingCount++; continue; }    // manifest mode
        if (result.imagePath) variants.push(result.imagePath);
      }

      if (variants.length > 0) {
        updatedScenes[i] = {
          ...scene,
          variant_urls: variants,
          asset_url:    variants[0],            // provisional; QA stage re-selects
          asset_type:   AssetType.Still,
        };
      } else {
        updatedScenes[i] = { ...scene, asset_type: AssetType.Placeholder };
      }

      if (state.cost_usd > config.budgetUsd * 0.9) {
        logger.warn("visuals", `Approaching budget ($${state.cost_usd.toFixed(2)} / $${config.budgetUsd})`);
      }
    } catch (err) {
      logger.error("visuals", `Scene ${scene.scene_id} failed: ${(err as Error).message}`);
      updatedScenes[i] = { ...scene, asset_type: AssetType.Placeholder };
    }
  }

  state.scenes = updatedScenes;
  state.stage  = PipelineStage.Visualised;
  await saveJob(state);

  if (pendingCount > 0) {
    logger.warn("visuals",
      `MANIFEST MODE: ${pendingCount} generations queued in generation_manifest.json. ` +
      `Fulfil them via the Higgsfield MCP in a Claude Code chat, save the images into the ` +
      `assets folder under the listed filenames, then resume the job.`);
  }

  const generated = updatedScenes.filter(s => s.asset_url).length;
  const failed    = updatedScenes.filter(s => s.asset_type === AssetType.Placeholder).length;
  logger.success("visuals", `Assets: ${generated} generated, ${failed} pending/placeholder`);
  return updatedScenes;
}

/** A scene is a "character scene" if any lead (POV or detailed side character) appears. */
function hasLead(scene: SceneCard, series: SeriesConfig): boolean {
  const leadIds = new Set([
    series.protagonist.id,
    ...series.characters.filter(c => c.role === CharacterRole.Detailed).map(c => c.id),
  ]);
  return scene.character_refs.some(id => leadIds.has(id));
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
