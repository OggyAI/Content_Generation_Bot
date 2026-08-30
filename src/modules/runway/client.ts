/**
 * Runway Gen-3 Alpha video generation client.
 * Used in PREMIUM mode only, for high-priority/dramatic scenes.
 */
import axios from "axios";
import path from "path";
import fs from "fs-extra";
import { config } from "../../config/defaults";
import { withRetry, sleep } from "../../utils/retry";
import { logger } from "../../utils/logger";
import { getCached, setCached, hashKey } from "../../utils/cache";

const BASE_URL = "https://api.runwayml.com/v1";
const COST_PER_5S_CLIP = 0.50;
const POLL_INTERVAL_MS  = 8_000;
const MAX_POLL_ATTEMPTS = 30;

export interface VideoResult {
  videoPath: string;
  costUsd:   number;
  cached:    boolean;
}

export async function generateVideoClip(
  prompt:    string,
  imageUrl:  string,   // seed image for image-to-video
  outputDir: string,
  filename:  string,
  seconds = 5
): Promise<VideoResult> {
  const cacheKey = hashKey(`video:${prompt}:${imageUrl}:${seconds}s`);
  const cached   = await getCached(cacheKey);

  if (cached) {
    return { videoPath: cached, costUsd: 0, cached: true };
  }

  return withRetry(async () => {
    logger.step("runway", `Submitting video gen: ${filename} (${seconds}s)`);

    // 1. Submit generation task
    const submitRes = await axios.post(
      `${BASE_URL}/image_to_video`,
      {
        model:       config.runwayModel,
        promptImage: imageUrl,
        promptText:  prompt,
        duration:    seconds,
        ratio:       "1280:768",
      },
      {
        headers: {
          Authorization: `Bearer ${config.runwayApiKey}`,
          "Content-Type": "application/json",
          "X-Runway-Version": "2024-11-06",
        },
      }
    );

    const taskId = submitRes.data.id as string;
    logger.info("runway", `Task submitted: ${taskId}`);

    // 2. Poll for completion
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const pollRes = await axios.get(`${BASE_URL}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${config.runwayApiKey}` },
      });

      const status = pollRes.data.status;

      if (status === "SUCCEEDED") {
        const videoUrl = pollRes.data.output[0] as string;
        await fs.ensureDir(outputDir);
        const videoPath = path.join(outputDir, `${filename}.mp4`);

        const download = await axios.get(videoUrl, { responseType: "arraybuffer" });
        await fs.writeFile(videoPath, Buffer.from(download.data));

        const costUsd = (seconds / 5) * COST_PER_5S_CLIP;
        await setCached(cacheKey, videoPath);
        logger.success("runway", `Saved ${filename}.mp4 — $${costUsd.toFixed(4)}`);
        return { videoPath, costUsd, cached: false };
      }

      if (status === "FAILED") {
        throw new Error(`Runway task ${taskId} failed: ${JSON.stringify(pollRes.data)}`);
      }

      logger.info("runway", `Task ${taskId} status: ${status} (attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS})`);
    }

    throw new Error(`Runway task ${taskId} timed out after ${MAX_POLL_ATTEMPTS} poll attempts`);
  }, `Runway:${filename}`);
}
