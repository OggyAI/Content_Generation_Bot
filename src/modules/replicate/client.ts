/**
 * Replicate image generation client.
 *  - Flux 1.1 Pro          → text-to-image background plates / generic stills.
 *  - Nano Banana           → reference-conditioned (image-input) character scenes,
 *                            so the detailed character stays on-model (Master Brief Part 6).
 *
 * Both are REST-API and batch-callable, which is why Replicate is the automated backbone.
 */
import axios from "axios";
import path from "path";
import fs from "fs-extra";
import { config } from "../../config/defaults";
import { withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";
import { getCached, setCached, hashKey } from "../../utils/cache";
import { ImageResult } from "../stability/client";

const BASE_URL       = "https://api.replicate.com/v1";
const FLUX_MODEL     = "black-forest-labs/flux-1.1-pro";
const COST_FLUX      = 0.04;
const COST_NANO      = 0.04;
const POLL_INTERVAL  = 2000;       // ms between status checks
const MAX_WAIT_MS    = 120_000;    // 2 min timeout

// ─── FLUX 1.1 PRO (text-to-image) ───────────────────────────────────────────────
export async function generateImageFlux(
  prompt:         string,
  negativePrompt: string,
  outputDir:      string,
  filename:       string,
): Promise<ImageResult> {
  const cacheKey = hashKey(`flux:${prompt}:${negativePrompt}`);
  const cached   = await getCached(cacheKey);
  if (cached) return { imagePath: cached, costUsd: 0, cached: true };

  return withRetry(async () => {
    logger.step("replicate", `Flux 1.1 Pro: ${filename}`);
    const output = await runPrediction(FLUX_MODEL, {
      prompt,
      aspect_ratio:      "16:9",
      output_format:     "jpg",
      output_quality:    90,
      safety_tolerance:  3,
      prompt_upsampling: true,
    }, filename);

    const imagePath = await downloadOutput(output, outputDir, filename);
    await setCached(cacheKey, imagePath);
    logger.success("replicate", `Saved ${filename}.jpg — $${COST_FLUX.toFixed(4)}`);
    return { imagePath, costUsd: COST_FLUX, cached: false };
  }, `Replicate:flux:${filename}`);
}

// ─── NANO BANANA (reference-conditioned image-to-image) ──────────────────────────
/**
 * Generate a scene that keeps a detailed character on-model by passing its reference
 * sheet as image input. The prompt should describe ONLY the new scene/pose — identity
 * is inferred from the reference image (Master Brief Part 6, method 1).
 */
export async function generateImageNanoBanana(
  prompt:              string,
  referenceImagePaths: string[],   // e.g. [characterSheet, styleReference]
  outputDir:           string,
  filename:            string,
): Promise<ImageResult> {
  const refs = referenceImagePaths.filter(Boolean);
  const cacheKey = hashKey(`nano:${prompt}:${refs.join("|")}`);
  const cached   = await getCached(cacheKey);
  if (cached) return { imagePath: cached, costUsd: 0, cached: true };

  return withRetry(async () => {
    logger.step("replicate", `Nano Banana (${refs.length} ref): ${filename}`);

    const imageInput = await Promise.all(refs.map(toImageInput));
    const output = await runPrediction(config.nanoBananaModel, {
      prompt,
      image_input:   imageInput,
      output_format: "jpg",
    }, filename);

    const imagePath = await downloadOutput(output, outputDir, filename);
    await setCached(cacheKey, imagePath);
    logger.success("replicate", `Saved ${filename}.jpg — $${COST_NANO.toFixed(4)}`);
    return { imagePath, costUsd: COST_NANO, cached: false };
  }, `Replicate:nano:${filename}`);
}

// ─── SHARED HELPERS ─────────────────────────────────────────────────────────────
async function runPrediction(model: string, input: Record<string, unknown>, label: string): Promise<unknown> {
  const submitRes = await axios.post(
    `${BASE_URL}/models/${model}/predictions`,
    { input },
    {
      headers: {
        Authorization:  `Token ${config.replicateApiToken}`,
        "Content-Type": "application/json",
        Prefer:         "wait=5",
      },
    }
  );

  let prediction = submitRes.data;
  const deadline = Date.now() + MAX_WAIT_MS;

  while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    if (Date.now() > deadline) throw new Error(`Replicate prediction timed out after ${MAX_WAIT_MS / 1000}s`);
    await sleep(POLL_INTERVAL);
    const pollRes = await axios.get(`${BASE_URL}/predictions/${prediction.id}`, {
      headers: { Authorization: `Token ${config.replicateApiToken}` },
    });
    prediction = pollRes.data;
    logger.info("replicate", `  ${label}: ${prediction.status}`);
  }

  if (prediction.status !== "succeeded" || !prediction.output) {
    throw new Error(`Replicate generation failed: ${prediction.error ?? "unknown error"}`);
  }
  return prediction.output;
}

async function downloadOutput(output: unknown, outputDir: string, filename: string): Promise<string> {
  const imageUrl = Array.isArray(output) ? output[0] : output;
  const imageRes = await axios.get<ArrayBuffer>(imageUrl as string, { responseType: "arraybuffer" });
  await fs.ensureDir(outputDir);
  const imagePath = path.join(outputDir, `${filename}.jpg`);
  await fs.writeFile(imagePath, Buffer.from(imageRes.data));
  return imagePath;
}

/** Convert a local reference image to a data URI (Replicate accepts these as file inputs). */
async function toImageInput(refPath: string): Promise<string> {
  if (/^https?:\/\//i.test(refPath)) return refPath;       // already a public URL
  const buf  = await fs.readFile(refPath);
  const ext  = path.extname(refPath).toLowerCase().replace(".", "") || "png";
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${buf.toString("base64")}`;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
