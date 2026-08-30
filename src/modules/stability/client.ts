/**
 * Stability AI image generation client.
 * Used in low-cost mode for scene stills.
 */
import axios from "axios";
import path from "path";
import fs from "fs-extra";
import FormData from "form-data";
import { config } from "../../config/defaults";
import { withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";
import { getCached, setCached, hashKey } from "../../utils/cache";

const BASE_URL = "https://api.stability.ai/v1/generation";
const COST_PER_IMAGE = 0.04;

export interface ImageResult {
  imagePath: string;
  costUsd:   number;
  cached:    boolean;
}

export async function generateImage(
  prompt:         string,
  negativePrompt: string,
  outputDir:      string,
  filename:       string,
  width  = 1344,
  height = 768    // 16:9 approx
): Promise<ImageResult> {
  const cacheKey = hashKey(`img:${prompt}:${negativePrompt}:${width}x${height}`);
  const cached   = await getCached(cacheKey);

  if (cached) {
    return { imagePath: cached, costUsd: 0, cached: true };
  }

  return withRetry(async () => {
    logger.step("stability", `Generating image: ${filename}`);

    const response = await axios.post(
      `${BASE_URL}/${config.stabilityModel}/text-to-image`,
      {
        text_prompts: [
          { text: prompt,         weight: 1.0 },
          { text: negativePrompt, weight: -1.0 },
        ],
        cfg_scale: 7,
        height,
        width,
        samples: 1,
        steps: 30,
      },
      {
        headers: {
          Authorization: `Bearer ${config.stabilityApiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    await fs.ensureDir(outputDir);
    const imagePath = path.join(outputDir, `${filename}.png`);
    const b64       = response.data.artifacts[0].base64;
    await fs.writeFile(imagePath, Buffer.from(b64, "base64"));

    await setCached(cacheKey, imagePath);
    logger.success("stability", `Saved ${filename}.png — $${COST_PER_IMAGE.toFixed(4)}`);

    return { imagePath, costUsd: COST_PER_IMAGE, cached: false };
  }, `Stability:${filename}`);
}
