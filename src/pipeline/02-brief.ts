import { v4 as uuid } from "uuid";
import { JobState, TopicBrief, PipelineStage } from "../types";
import { callClaudeJSON } from "../modules/claude/client";
import { buildBriefPrompt } from "../prompts/brief";
import { saveJob } from "../utils/job-store";
import { logger } from "../utils/logger";

export async function generateBrief(state: JobState): Promise<TopicBrief> {
  if (!state.classification) throw new Error("Classification required before brief");

  logger.step("brief", `Generating topic brief for: "${state.topic_input.topic}"`);

  const userPrompt = buildBriefPrompt(state.topic_input.topic, state.classification);

  const { data, costUsd } = await callClaudeJSON<Partial<TopicBrief>>(
    "You are a senior content researcher. Respond only with valid JSON.",
    userPrompt,
    4096,
    "brief"
  );

  const brief: TopicBrief = {
    brief_id:       uuid(),
    topic:          state.topic_input.topic,
    pillar:         state.classification.pillar,
    format_mode:    state.classification.format_mode,
    era:            data.era           ?? state.classification.era ?? "unknown",
    setting:        data.setting       ?? state.classification.setting ?? "unknown",
    key_facts:      data.key_facts     ?? [],
    key_figures:    data.key_figures   ?? [],
    tone_notes:     data.tone_notes    ?? state.classification.tone_guidance,
    opening_style:  data.opening_style ?? "POV: You are...",
    world_context:  data.world_context ?? "",
    visual_palette: data.visual_palette ?? "",
    research_notes: [],
    created_at:     new Date().toISOString(),
  };

  state.brief     = brief;
  state.cost_usd += costUsd;
  state.stage     = PipelineStage.Briefed;
  await saveJob(state);

  logger.success("brief", `Brief generated — ${brief.key_facts.length} facts, era: ${brief.era}`);
  return brief;
}
