import path from "path";
import { JobState, PipelineStage } from "../types";
import { submitRender, pollRender, downloadRender } from "../modules/shotstack/client";
import { saveJob, jobDir } from "../utils/job-store";
import { logger } from "../utils/logger";

export async function renderVideo(state: JobState): Promise<string> {
  if (!state.render_plan) throw new Error("Render plan required before rendering");

  // Reuse an already-submitted render if we have one (e.g. resuming after a poll timeout) —
  // this re-polls the SAME render instead of paying to render it again.
  let renderId = state.render_id;
  if (renderId) {
    logger.step("render", `Re-polling existing Shotstack render: ${renderId}`);
  } else {
    logger.step("render", "Submitting render to Shotstack...");
    renderId = await submitRender(state.render_plan);
    state.render_id = renderId;
    await saveJob(state);   // persist immediately so a timeout doesn't lose the render
  }

  let result;
  try {
    result = await pollRender(renderId);
  } catch (err) {
    // A genuine render failure → drop the id so a future resume can submit fresh.
    // A timeout → keep the id so resume re-polls the same render.
    if (/render failed/i.test((err as Error).message)) {
      state.render_id = undefined;
      await saveJob(state);
    }
    throw err;
  }

  const outputPath = path.join(jobDir(state.job_id), "draft_render.mp4");
  await downloadRender(result.videoUrl, outputPath);

  state.render_url  = outputPath;
  state.render_id   = undefined;       // finished
  state.cost_usd   += result.costUsd;
  state.stage       = PipelineStage.Rendered;
  await saveJob(state);

  logger.success("render", `Draft render saved: ${outputPath}`);
  return outputPath;
}
