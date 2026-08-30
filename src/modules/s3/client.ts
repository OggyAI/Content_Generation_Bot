/**
 * S3-compatible upload client using AWS SDK v3.
 * Works with Cloudflare R2, AWS S3, and any S3-compatible provider.
 */
import fs from "fs-extra";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../../config/defaults";
import { logger } from "../../utils/logger";
import { withRetry } from "../../utils/retry";

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (s3Client) return s3Client;

  s3Client = new S3Client({
    region:      config.s3Region || "auto",
    endpoint:    config.s3Endpoint || undefined,
    credentials: {
      accessKeyId:     config.s3AccessKey,
      secretAccessKey: config.s3SecretKey,
    },
    // R2 requires this for path-style access
    forcePathStyle: true,
  });

  return s3Client;
}

/**
 * Upload a local file to S3/R2 and return its public URL.
 */
export async function uploadToS3(
  localPath: string,
  remoteKey: string
): Promise<string> {
  return withRetry(async () => {
    const fileBuffer  = await fs.readFile(localPath);
    const contentType = getContentType(localPath);

    const client = getClient();
    await client.send(new PutObjectCommand({
      Bucket:      config.s3Bucket,
      Key:         remoteKey,
      Body:        fileBuffer,
      ContentType: contentType,
    }));

    const publicUrl = `${config.s3BaseUrl.replace(/\/$/, "")}/${remoteKey}`;
    logger.success("s3", `Uploaded: ${remoteKey}`);
    return publicUrl;
  }, `S3:${path.basename(localPath)}`);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".mp3":  "audio/mpeg",
    ".mp4":  "video/mp4",
    ".json": "application/json",
    ".srt":  "text/plain",
  };
  return types[ext] ?? "application/octet-stream";
}
