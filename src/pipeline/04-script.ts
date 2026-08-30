import path from "path";
import fs from "fs-extra";
import { v4 as uuid } from "uuid";
import { JobState, ScriptDraft, PipelineStage } from "../types";
import { callClaude } from "../modules/claude/client";
import { buildScriptSystemPrompt, buildScriptUserPrompt } from "../prompts/script";
import { ACTIVE_SERIES } from "../config/series";
import { saveJob } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";

export async function generateScript(state: JobState): Promise<ScriptDraft> {
  if (!state.brief || !state.outline) throw new Error("Brief and outline required before script");

  const series = state.series ?? ACTIVE_SERIES;

  logger.step("script", "Generating full narration script (Master Brief Part 2 formula)...");

  const referenceTranscripts = await loadReferenceTranscripts();
  if (referenceTranscripts) {
    logger.info("script", "Reference transcripts attached as voice/rhythm style refs");
  }

  const systemPrompt = buildScriptSystemPrompt(series);
  const userPrompt   = buildScriptUserPrompt(
    state.brief,
    state.outline,
    series,
    config.wordsPerMinute,
    referenceTranscripts
  );

  // Generous output ceiling so the script ALWAYS finishes its structured ending (climax +
  // disclaimer + moral question + CTA). The PROMPT controls length (1,800–2,800 words); this
  // is only a safety ceiling. A low cap previously truncated the ending mid-sentence.
  const maxScriptTokens = 8000;

  const { text, costUsd } = await callClaude(systemPrompt, userPrompt, maxScriptTokens, "script");

  const wordCount    = countWords(text);
  const estimatedMin = wordCount / config.wordsPerMinute;

  const script: ScriptDraft = {
    script_id:     uuid(),
    topic:         state.topic_input.topic,
    full_text:     text.trim(),
    word_count:    wordCount,
    estimated_min: Math.round(estimatedMin * 10) / 10,
    version:       1,
    created_at:    new Date().toISOString(),
  };

  state.script    = script;
  state.cost_usd += costUsd;
  state.stage     = PipelineStage.Scripted;
  await saveJob(state);

  logger.success("script", `Script: ${wordCount} words (~${script.estimated_min} min)`);
  if (wordCount < 1800) logger.warn("script", "Script under 1,800-word target — consider regenerating");
  return script;
}

/**
 * Load reference transcripts (Master Brief: keep the analyzed exemplar .txt files in a
 * /references folder). Injected as VOICE/RHYTHM references only — never copied.
 */
async function loadReferenceTranscripts(): Promise<string> {
  const refDir = path.join(process.cwd(), "references");
  try {
    if (!(await fs.pathExists(refDir))) return "";
    const files = (await fs.readdir(refDir)).filter(f => f.toLowerCase().endsWith(".txt"));
    if (files.length === 0) return "";

    const blocks: string[] = [];
    for (const file of files.slice(0, 2)) {  // cap at 2 references to control token cost
      const content = (await fs.readFile(path.join(refDir, file), "utf-8")).trim();
      if (content) blocks.push(`### Reference: ${file}\n${content}`);
    }
    return blocks.join("\n\n");
  } catch {
    return "";
  }
}

function countWords(text: string): number {
  // Strip scene markers then count
  return text
    .replace(/\[SCENE:[^\]]+\]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}
