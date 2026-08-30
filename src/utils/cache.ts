/**
 * Simple file-based asset cache.
 * Avoids re-generating images/audio that already exist.
 */
import crypto from "crypto";
import path from "path";
import fs from "fs-extra";
import { config } from "../config/defaults";
import { logger } from "./logger";

const CACHE_INDEX_PATH = path.join(config.storagePath, "cache", "index.json");

type CacheIndex = Record<string, string>; // hash → file path

async function loadIndex(): Promise<CacheIndex> {
  await fs.ensureDir(path.dirname(CACHE_INDEX_PATH));
  if (!(await fs.pathExists(CACHE_INDEX_PATH))) return {};
  return fs.readJson(CACHE_INDEX_PATH);
}

async function saveIndex(index: CacheIndex): Promise<void> {
  await fs.writeJson(CACHE_INDEX_PATH, index, { spaces: 2 });
}

export function hashKey(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").substring(0, 16);
}

export async function getCached(key: string): Promise<string | null> {
  const index = await loadIndex();
  const filePath = index[key];
  if (filePath && (await fs.pathExists(filePath))) {
    logger.info("cache", `HIT  ${key}`);
    return filePath;
  }
  return null;
}

export async function setCached(key: string, filePath: string): Promise<void> {
  const index = await loadIndex();
  index[key] = filePath;
  await saveIndex(index);
  logger.info("cache", `SET  ${key} → ${filePath}`);
}

export async function clearCache(): Promise<void> {
  await fs.writeJson(CACHE_INDEX_PATH, {}, { spaces: 2 });
  logger.warn("cache", "Cache index cleared");
}
