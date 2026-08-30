/**
 * Approval gate handler.
 *
 * In "file" mode:
 *   - Writes  output/jobs/<job_id>/gate_<gate_id>.pending.json
 *   - Polls for output/jobs/<job_id>/gate_<gate_id>.approved.json
 *     (human drops this file to continue)
 *
 * The approved/rejected file should be:
 *   { "status": "approved" | "rejected", "notes": "optional reviewer notes" }
 */
import path from "path";
import fs from "fs-extra";
import { ApprovalGate, ApprovalStatus } from "../types";
import { jobDir, loadJob, saveJob } from "./job-store";
import { logger } from "./logger";
import { sleep } from "./retry";

const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS       = 60 * 60 * 1000; // 1 hour

export async function requestApproval(
  jobId: string,
  gate: ApprovalGate,
  preview?: Record<string, unknown>
): Promise<ApprovalGate> {
  const dir       = jobDir(jobId);
  const pending   = path.join(dir, `gate_${gate.gate_id}.pending.json`);
  const approved  = path.join(dir, `gate_${gate.gate_id}.approved.json`);
  const rejected  = path.join(dir, `gate_${gate.gate_id}.rejected.json`);

  // Write the pending gate file so a human (or n8n webhook) can inspect it
  await fs.writeJson(pending, { gate, preview, instructions: "Create gate_<id>.approved.json or gate_<id>.rejected.json to continue" }, { spaces: 2 });

  logger.gate("approval", `Gate "${gate.label}" is waiting for review.\n  Job: ${jobId}\n  File: ${pending}\n  Drop: ${approved}`);

  const started = Date.now();

  while (Date.now() - started < TIMEOUT_MS) {
    if (await fs.pathExists(approved)) {
      const response = await fs.readJson(approved);
      gate.status    = ApprovalStatus.Approved;
      gate.notes     = response.notes ?? "";
      gate.timestamp = new Date().toISOString();
      await updateGate(jobId, gate);
      await fs.remove(pending);
      logger.success("approval", `Gate "${gate.label}" APPROVED`);
      return gate;
    }

    if (await fs.pathExists(rejected)) {
      const response = await fs.readJson(rejected);
      gate.status    = ApprovalStatus.Rejected;
      gate.notes     = response.notes ?? "";
      gate.timestamp = new Date().toISOString();
      await updateGate(jobId, gate);
      await fs.remove(pending);
      logger.error("approval", `Gate "${gate.label}" REJECTED: ${gate.notes}`);
      throw new Error(`Approval gate rejected: ${gate.label}. Notes: ${gate.notes}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Approval gate timed out after 1 hour: ${gate.label}`);
}

async function updateGate(jobId: string, gate: ApprovalGate): Promise<void> {
  const state = await loadJob(jobId);
  const idx   = state.approval_gates.findIndex(g => g.gate_id === gate.gate_id);
  if (idx >= 0) state.approval_gates[idx] = gate;
  else           state.approval_gates.push(gate);
  await saveJob(state);
}
