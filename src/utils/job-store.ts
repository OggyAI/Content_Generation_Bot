/**
 * Persists and loads JobState to/from disk.
 * Each job lives at: output/jobs/<job_id>/state.json
 */
import path from "path";
import fs from "fs-extra";
import { JobState, PipelineStage } from "../types";
import { config } from "../config/defaults";
import { logger } from "./logger";

export function jobDir(jobId: string): string {
  return path.join(config.storagePath, "jobs", jobId);
}

export async function saveJob(state: JobState): Promise<void> {
  const dir = jobDir(state.job_id);
  await fs.ensureDir(dir);
  state.updated_at = new Date().toISOString();
  await fs.writeJson(path.join(dir, "state.json"), state, { spaces: 2 });
}

export async function loadJob(jobId: string): Promise<JobState> {
  const filePath = path.join(jobDir(jobId), "state.json");
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`Job not found: ${jobId}`);
  }
  return fs.readJson(filePath) as Promise<JobState>;
}

export async function updateJobStage(jobId: string, stage: PipelineStage): Promise<void> {
  const state = await loadJob(jobId);
  state.stage = stage;
  await saveJob(state);
  logger.step("job-store", `Job ${jobId} → stage: ${stage}`);
}

export async function addJobError(
  jobId: string,
  stage: PipelineStage,
  message: string,
  retries: number
): Promise<void> {
  const state = await loadJob(jobId);
  state.errors.push({ stage, message, retries, timestamp: new Date().toISOString() });
  await saveJob(state);
}

export async function listJobs(): Promise<string[]> {
  const jobsDir = path.join(config.storagePath, "jobs");
  await fs.ensureDir(jobsDir);
  const entries = await fs.readdir(jobsDir, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}
