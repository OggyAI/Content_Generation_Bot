import Anthropic from "@anthropic-ai/sdk";
import fs from "fs-extra";
import path from "path";
import { config } from "../../config/defaults";
import { withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export interface ClaudeResponse {
  text:        string;
  tokensIn:    number;
  tokensOut:   number;
  costUsd:     number;
}

const INPUT_COST_PER_1M  = 15.00;  // Opus 4.6
const OUTPUT_COST_PER_1M = 75.00;

export async function callClaude(
  systemPrompt: string,
  userPrompt:   string,
  maxTokens:    number = 4096,
  label:        string = "claude"
): Promise<ClaudeResponse> {
  return withRetry(async () => {
    logger.step("claude", `Calling model for: ${label}`);

    const response = await client.messages.create({
      model:      config.anthropicModel,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userPrompt }],
    });

    const text     = response.content[0].type === "text" ? response.content[0].text : "";
    const tokensIn = response.usage.input_tokens;
    const tokensOut= response.usage.output_tokens;
    const costUsd  = (tokensIn / 1_000_000) * INPUT_COST_PER_1M
                   + (tokensOut / 1_000_000) * OUTPUT_COST_PER_1M;

    logger.success("claude", `${label} — ${tokensIn}in / ${tokensOut}out — $${costUsd.toFixed(4)}`);
    return { text, tokensIn, tokensOut, costUsd };
  }, `Claude:${label}`);
}

/**
 * Call Claude and parse the response as JSON.
 * Strips markdown fences if present (LLMs sometimes add them despite instructions).
 */
export async function callClaudeJSON<T>(
  systemPrompt: string,
  userPrompt:   string,
  maxTokens:    number = 4096,
  label:        string = "claude-json"
): Promise<{ data: T; tokensIn: number; tokensOut: number; costUsd: number }> {
  const result = await callClaude(systemPrompt, userPrompt, maxTokens, label);
  const text   = stripMarkdownFences(result.text);

  try {
    const data = JSON.parse(text) as T;
    return { data, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
  } catch (err) {
    logger.error("claude", `JSON parse failed for ${label}. Raw response:\n${text}`);
    throw new Error(`Claude returned invalid JSON for ${label}: ${(err as Error).message}`);
  }
}

/**
 * Vision call — sends one or more local images plus a text instruction, returns parsed JSON.
 * Used by the Visual QA-and-select stage to score generated variants (Master Brief Part 9).
 */
export async function callClaudeVisionJSON<T>(
  systemPrompt: string,
  userText:     string,
  imagePaths:   string[],
  maxTokens:    number = 1024,
  label:        string = "claude-vision"
): Promise<{ data: T; costUsd: number }> {
  return withRetry(async () => {
    const imageBlocks = await Promise.all(
      imagePaths.map(async (p) => {
        const buf  = await fs.readFile(p);
        const ext  = path.extname(p).toLowerCase().replace(".", "");
        const mediaType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
        return {
          type: "image" as const,
          source: { type: "base64" as const, media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: buf.toString("base64") },
        };
      })
    );

    const response = await client.messages.create({
      model:      config.anthropicModel,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: "user", content: [...imageBlocks, { type: "text", text: userText }] }],
    });

    const text     = response.content[0].type === "text" ? response.content[0].text : "";
    const tokensIn = response.usage.input_tokens;
    const tokensOut= response.usage.output_tokens;
    const costUsd  = (tokensIn / 1_000_000) * INPUT_COST_PER_1M + (tokensOut / 1_000_000) * OUTPUT_COST_PER_1M;

    const data = JSON.parse(stripMarkdownFences(text)) as T;
    logger.success("claude", `${label} — ${tokensIn}in / ${tokensOut}out — $${costUsd.toFixed(4)}`);
    return { data, costUsd };
  }, `Claude:${label}`);
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();
}
