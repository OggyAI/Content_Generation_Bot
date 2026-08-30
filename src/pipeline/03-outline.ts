import { v4 as uuid } from "uuid";
import { JobState, Outline, OutlineSection, PipelineStage } from "../types";
import { callClaudeJSON } from "../modules/claude/client";
import { buildOutlinePrompt } from "../prompts/outline";
import { saveJob } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";

export async function generateOutline(state: JobState): Promise<Outline> {
  if (!state.brief) throw new Error("Brief required before outline");

  logger.step("outline", "Generating outline...");

  const targetMin  = (config.targetRuntimeMin + config.targetRuntimeMax) / 2;
  const userPrompt = buildOutlinePrompt(state.brief, targetMin);

  const { data, costUsd } = await callClaudeJSON<Partial<Outline>>(
    "You are a story structure expert and video scriptwriter. Respond only with valid JSON.",
    userPrompt,
    6000,
    "outline"
  );

  // Assign section IDs if missing
  const sections: OutlineSection[] = (data.sections ?? []).map((s: Partial<OutlineSection>, i: number) => ({
    ...s,
    section_id:    s.section_id ?? `sec_${i.toString().padStart(3, "0")}`,
    index:         i,
    label:         s.label ?? `Section ${i + 1}`,
    beat_type:     s.beat_type ?? "entry" as any,
    summary:       s.summary ?? "",
    estimated_min: s.estimated_min ?? 1,
    key_moments:   s.key_moments ?? [],
  }));

  const totalEstMin = sections.reduce((sum, s) => sum + s.estimated_min, 0);

  const outline: Outline = {
    outline_id:    uuid(),
    topic:         state.topic_input.topic,
    format_mode:   state.brief.format_mode,
    total_est_min: data.total_est_min ?? totalEstMin,
    sections,
    created_at:    new Date().toISOString(),
  };

  state.outline   = outline;
  state.cost_usd += costUsd;
  state.stage     = PipelineStage.Outlined;
  await saveJob(state);

  logger.success("outline", `${sections.length} sections, ~${outline.total_est_min.toFixed(1)} min`);
  return outline;
}
