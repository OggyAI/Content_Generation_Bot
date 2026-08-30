/**
 * Upload stage — pushes all local assets (images + audio) to S3/R2
 * so Shotstack can access them via public URLs during rendering.
 */
import path from "path";
import { JobState } from "../types";
import { uploadToS3 } from "../modules/s3/client";
import { saveJob, jobDir } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";

export async function uploadAssets(state: JobState): Promise<void> {
  if (!config.s3Bucket || !config.s3AccessKey) {
    logger.warn("upload", "S3 not configured — skipping upload. Shotstack will need public URLs.");
    return;
  }

  const jobId  = state.job_id;
  const prefix = `jobs/${jobId}`;

  logger.step("upload", "Uploading assets to S3/R2...");

  let uploaded = 0;

  // Upload scene images/videos
  if (state.scenes) {
    for (const scene of state.scenes) {
      if (scene.asset_url && !scene.asset_url.startsWith("http")) {
        try {
          const filename  = path.basename(scene.asset_url);
          const remoteKey = `${prefix}/assets/${filename}`;
          const publicUrl = await uploadToS3(scene.asset_url, remoteKey);
          scene.asset_url = publicUrl;
          uploaded++;
        } catch (err) {
          logger.error("upload", `Failed to upload asset for scene ${scene.scene_id}: ${(err as Error).message}`);
        }
      }

      // Upload scene sound effect (if any)
      if (scene.sfx_url && !scene.sfx_url.startsWith("http")) {
        try {
          const remoteKey = `${prefix}/sfx/${path.basename(scene.sfx_url)}`;
          scene.sfx_url   = await uploadToS3(scene.sfx_url, remoteKey);
          uploaded++;
        } catch (err) {
          logger.error("upload", `Failed to upload SFX for scene ${scene.scene_id}: ${(err as Error).message}`);
        }
      }
    }
  }

  // Upload voice audio chunks
  if (state.voice_chunks) {
    for (const chunk of state.voice_chunks) {
      if (chunk.audio_url && !chunk.audio_url.startsWith("http")) {
        try {
          const filename  = path.basename(chunk.audio_url);
          const remoteKey = `${prefix}/audio/${filename}`;
          const publicUrl = await uploadToS3(chunk.audio_url, remoteKey);
          chunk.audio_url = publicUrl;
          uploaded++;
        } catch (err) {
          logger.error("upload", `Failed to upload audio for chunk ${chunk.chunk_id}: ${(err as Error).message}`);
        }
      }
    }
  }

  await saveJob(state);
  logger.success("upload", `${uploaded} files uploaded to S3/R2`);
}
