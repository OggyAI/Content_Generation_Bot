import { v4 as uuid } from "uuid";
import { JobState, Classification, PipelineStage } from "../types";
import { callClaudeJSON } from "../modules/claude/client";
import { buildClassifyPrompt } from "../prompts/classify";
import { saveJob } from "../utils/job-store";
import { logger } from "../utils/logger";

export async function classifyTopic(state: JobState): Promise<Classification> {
  logger.step("classify", `Classifying: "${state.topic_input.topic}"`);

  const userPrompt = buildClassifyPrompt(
    state.topic_input.topic,
    state.topic_input.content_notes
  );

  const { data, costUsd } = await callClaudeJSON<Classification>(
    "You are a content strategy classifier. Respond only with valid JSON.",
    userPrompt,
    512,
    "classify"
  );

  const classification: Classification = {
    pillar:        data.pillar,
    format_mode:   data.format_mode,
    era:           data.era,
    setting:       data.setting,
    tone_guidance: data.tone_guidance,
    confidence:    data.confidence,
    reasoning:     data.reasoning,
  };

  state.classification = classification;
  state.cost_usd      += costUsd;
  state.stage          = PipelineStage.Classified;
  await saveJob(state);

  logger.success("classify", `Pillar: ${classification.pillar} | Mode: ${classification.format_mode} | Era: ${classification.era}`);
  return classification;
}
