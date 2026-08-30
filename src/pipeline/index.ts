/**
 * Main pipeline orchestrator.
 * Chains all stages together with approval gates and error handling.
 *
 * Usage:
 *   import { runPipeline } from "./pipeline";
 *   await runPipeline({ topic: "A Roman Legionary at Cannae", ... });
 */
import { v4 as uuid } from "uuid";
import {
  TopicInput, JobState, PipelineStage, ApprovalGate,
  ApprovalStatus, ProductionMode,
} from "../types";
import { config } from "../config/defaults";
import { ACTIVE_SERIES } from "../config/series";
import { saveJob, loadJob, addJobError } from "../utils/job-store";
import { requestApproval } from "../utils/approval";
import { logger } from "../utils/logger";

// Pipeline stages
import { classifyTopic } from "./01-classify";
import { generateBrief } from "./02-brief";
import { generateOutline } from "./03-outline";
import { generateScript } from "./04-script";
import { proposeCast, renderCast } from "./04b-characters";
import { splitIntoScenes } from "./05-scenes";
import { generateVisuals } from "./06-visuals";
import { selectVisuals } from "./06b-visual-qa";
import { generateVoiceovers } from "./07-voiceover";
import { buildTimeline } from "./08-timeline";
import { uploadAssets } from "./08b-upload";
import { renderVideo } from "./09-render";
import { runQA } from "./10-qa";
import { exportPackage } from "./11-export";

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

export async function runPipeline(input: TopicInput): Promise<JobState> {
  const jobId = uuid();
  logger.step("pipeline", `Starting job ${jobId}: "${input.topic}"`);

  const state: JobState = {
    job_id:          jobId,
    topic_input:     input,
    series:          ACTIVE_SERIES,      // lock the series look for this job
    stage:           PipelineStage.Ingested,
    approval_gates:  [],
    cost_usd:        0,
    errors:          [],
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  };

  await saveJob(state);
  return resumePipeline(jobId);
}

/**
 * Resume a pipeline from its last completed stage.
 * Useful after an approval gate pause or a crash recovery.
 */
export async function resumePipeline(jobId: string): Promise<JobState> {
  let state = await loadJob(jobId);

  // If the job previously failed, figure out where it actually got to and restart from there
  if (state.stage === PipelineStage.Failed) {
    const recovered = recoverFromFailed(state);
    logger.step("pipeline", `Job was in failed state — recovering to last good stage: ${recovered}`);
    state.stage = recovered;
    await saveJob(state);
  }

  logger.step("pipeline", `Resuming job ${jobId} from stage: ${state.stage}`);

  try {
    // ── STAGE 1: CLASSIFY ──────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.Ingested)) {
      state = await runStage(state, "classify", async () => {
        await classifyTopic(state);
      });
    }

    // ── STAGE 2: BRIEF ─────────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.Classified)) {
      state = await runStage(state, "brief", async () => {
        await generateBrief(state);
      });
    }

    // ── STAGE 3: OUTLINE ───────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.Briefed)) {
      state = await runStage(state, "outline", async () => {
        await generateOutline(state);
      });
    }

    // ─── GATE 1: Brief + Outline Review ────────────────────────────────
    if (state.stage === PipelineStage.Outlined) {
      await approvalGate(state, "gate_brief_outline", "Brief + Outline Review", PipelineStage.Outlined, {
        brief: state.brief,
        outline: state.outline,
      });
    }

    // ── STAGE 4: SCRIPT ────────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.Outlined)) {
      state = await runStage(state, "script", async () => {
        await generateScript(state);
      });
    }

    // ─── GATE 2: Script Review ─────────────────────────────────────────
    if (state.stage === PipelineStage.Scripted) {
      await approvalGate(state, "gate_script", "Full Script Review", PipelineStage.Scripted, {
        script_excerpt: state.script?.full_text.substring(0, 1000),
        word_count: state.script?.word_count,
        estimated_min: state.script?.estimated_min,
      });
    }

    // ── STAGE 4b: CAST DESIGN (editable text blueprints — before sheets draw) ──
    if (shouldRun(state, PipelineStage.Scripted)) {
      state = await runStage(state, "cast-design", async () => {
        await proposeCast(state);
      });
    }

    // ─── GATE 2b: Cast Design Review (EDIT cast.json before sheets draw) ──
    if (state.stage === PipelineStage.CastDesigned) {
      await approvalGate(state, "gate_cast_design", "Cast Design Review", PipelineStage.CastDesigned, {
        characters: (state.series?.characters ?? []).map(c => ({ id: c.id, name: c.name, blueprint: c.blueprint_prompt })),
        edit_file: `output/jobs/${state.job_id}/cast.json`,
        note: "Optional: edit cast.json to reword any character's look BEFORE the sheets draw, then approve.",
      });
    }

    // ── STAGE 4c: RENDER REFERENCE SHEETS (from the edited cast) ────────
    if (shouldRun(state, PipelineStage.CastDesigned)) {
      state = await runStage(state, "cast-sheets", async () => {
        await renderCast(state);
      });
    }

    // ─── GATE 2c: Character Sheet Review ───────────────────────────────
    if (state.stage === PipelineStage.CharactersDesigned) {
      await approvalGate(state, "gate_characters", "Character Sheet Review", PipelineStage.CharactersDesigned, {
        characters: (state.series?.characters ?? []).map(c => ({
          id: c.id, name: c.name, reference_sheet: c.reference_sheet_url,
        })),
        crowd_style: state.series?.crowd_style,
        note: "Review the sheets in assets/characters/ — reject to regenerate.",
      });
    }

    // ── STAGE 5: SCENES ────────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.CharactersDesigned)) {
      state = await runStage(state, "scenes", async () => {
        await splitIntoScenes(state);
      });
    }

    // ── STAGE 6: VISUALS ───────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.Scened)) {
      state = await runStage(state, "visuals", async () => {
        await generateVisuals(state);
      });
    }

    // ── STAGE 6b: VISUAL QA-AND-SELECT ─────────────────────────────────
    if (shouldRun(state, PipelineStage.Visualised)) {
      state = await runStage(state, "visual-qa", async () => {
        await selectVisuals(state);
      });
    }

    // ─── GATE 3: Selected Scene Assets Review ──────────────────────────
    if (state.stage === PipelineStage.VisualSelected) {
      const previewScenes = (state.scenes ?? []).slice(0, 5).map(s => ({
        scene_id: s.scene_id,
        shot_type: s.shot_type,
        visual_prompt: s.visual_prompt,
        asset_url: s.asset_url,
        asset_type: s.asset_type,
        qa_score: s.qa_score,
        qa_notes: s.qa_notes,
      }));
      await approvalGate(state, "gate_visuals", "First 5 Scene Assets Review", PipelineStage.VisualSelected, {
        preview_scenes: previewScenes,
        total_scenes: state.scenes?.length,
        avg_qa_score: avgQaScore(state),
        cost_so_far: state.cost_usd,
      });
    }

    // ── STAGE 7: VOICEOVER ─────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.VisualSelected)) {
      state = await runStage(state, "voiceover", async () => {
        await generateVoiceovers(state);
      });
    }

    // ── STAGE 8: TIMELINE ──────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.Voiced)) {
      state = await runStage(state, "timeline", async () => {
        await buildTimeline(state);
      });
    }

    // ── STAGE 8b: UPLOAD + RENDER ─────────────────────────────────────
    if (shouldRun(state, PipelineStage.Timed)) {
      // Upload local assets to S3/R2 so Shotstack can access them
      await uploadAssets(state);
      state = await loadJob(state.job_id);
      // Rebuild timeline with public URLs
      await buildTimeline(state);
      state = await loadJob(state.job_id);
      // Now render
      state = await runStage(state, "render", async () => {
        await renderVideo(state);
      });
    }

    // ── STAGE 10: QA ───────────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.Rendered)) {
      state = await runStage(state, "qa", async () => {
        await runQA(state);
      });
    }

    // ─── GATE 4: Final Draft Review ────────────────────────────────────
    if (state.stage === PipelineStage.QADone) {
      await approvalGate(state, "gate_final", "Final Draft Render Review", PipelineStage.QADone, {
        render_url: state.render_url,
        qa_passed: state.qa_report?.passed,
        qa_errors: state.qa_report?.checks.filter(c => !c.passed),
        total_cost: state.cost_usd,
      });
    }

    // ── STAGE 11: EXPORT ───────────────────────────────────────────────
    if (shouldRun(state, PipelineStage.QADone)) {
      state = await runStage(state, "export", async () => {
        await exportPackage(state);
      });
    }

    // ── DONE ───────────────────────────────────────────────────────────
    logger.success("pipeline", `Job ${state.job_id} COMPLETE — total cost: $${state.cost_usd.toFixed(2)}`);
    return state;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("pipeline", `Job ${state.job_id} FAILED at stage ${state.stage}: ${message}`);
    state.stage = PipelineStage.Failed;
    state.errors.push({
      stage: state.stage,
      message,
      retries: 0,
      timestamp: new Date().toISOString(),
    });
    await saveJob(state);
    throw err;
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function shouldRun(state: JobState, requiredStage: PipelineStage): boolean {
  return state.stage === requiredStage;
}

function avgQaScore(state: JobState): number | undefined {
  const scored = (state.scenes ?? []).filter(s => s.qa_score != null);
  if (scored.length === 0) return undefined;
  return Math.round((scored.reduce((a, s) => a + (s.qa_score ?? 0), 0) / scored.length) * 10) / 10;
}

/**
 * When a job is in "failed" state, determine the last successfully completed stage
 * by checking which data exists on the state object, then reset to that stage
 * so the pipeline can retry from the point of failure.
 */
function recoverFromFailed(state: JobState): PipelineStage {
  if (state.video_package)   return PipelineStage.Exported;
  if (state.qa_report)       return PipelineStage.QADone;
  if (state.render_url)      return PipelineStage.Rendered;
  if (state.render_plan)     return PipelineStage.Timed;
  if (state.voice_chunks)    return PipelineStage.Voiced;
  if (state.scenes?.some(s => s.qa_score != null)) return PipelineStage.VisualSelected;
  if (state.scenes?.some(s => s.asset_url)) return PipelineStage.Visualised;
  if (state.scenes)          return PipelineStage.Scened;
  if (state.cast_ready)      return PipelineStage.CharactersDesigned;
  if (state.cast_proposed)   return PipelineStage.CastDesigned;
  if (state.script)          return PipelineStage.Scripted;
  if (state.outline)         return PipelineStage.Outlined;
  if (state.brief)           return PipelineStage.Briefed;
  if (state.classification)  return PipelineStage.Classified;
  return PipelineStage.Ingested;
}

async function runStage(
  state: JobState,
  label: string,
  fn: () => Promise<void>
): Promise<JobState> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await addJobError(state.job_id, state.stage, message, 0);
    throw err;
  }
  return loadJob(state.job_id);
}

async function approvalGate(
  state: JobState,
  gateId: string,
  label: string,
  stage: PipelineStage,
  preview?: Record<string, unknown>
): Promise<void> {
  const gate: ApprovalGate = {
    gate_id:   gateId,
    label,
    stage,
    status:    ApprovalStatus.Pending,
  };

  await requestApproval(state.job_id, gate, preview);
}
