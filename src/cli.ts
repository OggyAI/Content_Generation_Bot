#!/usr/bin/env ts-node
/**
 * CLI runner for the content generation pipeline.
 *
 * Usage:
 *   npx ts-node src/cli.ts run "A Roman Legionary at the Battle of Cannae"
 *   npx ts-node src/cli.ts run "A Roman Legionary at Cannae" --mode premium --budget 15
 *   npx ts-node src/cli.ts resume <job-id>
 *   npx ts-node src/cli.ts status <job-id>
 *   npx ts-node src/cli.ts list
 *   npx ts-node src/cli.ts approve <job-id> <gate-id>
 *   npx ts-node src/cli.ts reject <job-id> <gate-id> "reason"
 */
import dotenv from "dotenv";
dotenv.config();

import path from "path";
import fs from "fs-extra";
import { runPipeline, resumePipeline } from "./pipeline";
import { listJobs, loadJob, jobDir } from "./utils/job-store";
import { logger } from "./utils/logger";
import { TopicInput, ProductionMode } from "./types";

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "run":
      return cmdRun();
    case "resume":
      return cmdResume();
    case "status":
      return cmdStatus();
    case "list":
      return cmdList();
    case "approve":
      return cmdApproveReject("approved");
    case "reject":
      return cmdApproveReject("rejected");
    default:
      printUsage();
  }
}

async function cmdRun() {
  const topic = args[0];
  if (!topic) {
    console.error("Error: topic is required.\nUsage: cli.ts run \"Topic title here\"");
    process.exit(1);
  }

  const modeFlag   = args.indexOf("--mode");
  const budgetFlag = args.indexOf("--budget");
  const lengthFlag = args.indexOf("--length");
  const notesFlag  = args.indexOf("--notes");

  const input: TopicInput = {
    topic,
    target_length_min: lengthFlag >= 0 ? parseFloat(args[lengthFlag + 1]) : 10,
    production_mode:   modeFlag >= 0 ? args[modeFlag + 1] as ProductionMode : ProductionMode.LowCost,
    budget_usd:        budgetFlag >= 0 ? parseFloat(args[budgetFlag + 1]) : undefined,
    content_notes:     notesFlag >= 0 ? args[notesFlag + 1] : undefined,
  };

  logger.step("cli", `Starting pipeline for: "${topic}"`);
  const state = await runPipeline(input);
  logger.success("cli", `Pipeline complete! Job: ${state.job_id}`);
  logger.info("cli", `Output: ${jobDir(state.job_id)}`);
  logger.info("cli", `Total cost: $${state.cost_usd.toFixed(2)}`);
}

async function cmdResume() {
  const jobId = args[0];
  if (!jobId) { console.error("Usage: cli.ts resume <job-id>"); process.exit(1); }

  logger.step("cli", `Resuming job: ${jobId}`);
  const state = await resumePipeline(jobId);
  logger.success("cli", `Pipeline complete! Stage: ${state.stage}`);
}

async function cmdStatus() {
  const jobId = args[0];
  if (!jobId) { console.error("Usage: cli.ts status <job-id>"); process.exit(1); }

  const state = await loadJob(jobId);
  console.log(JSON.stringify({
    job_id:    state.job_id,
    topic:     state.topic_input.topic,
    stage:     state.stage,
    cost_usd:  state.cost_usd,
    errors:    state.errors.length,
    gates:     state.approval_gates.map(g => ({ id: g.gate_id, label: g.label, status: g.status })),
    updated_at: state.updated_at,
  }, null, 2));
}

async function cmdList() {
  const ids = await listJobs();
  if (ids.length === 0) { console.log("No jobs found."); return; }

  for (const id of ids) {
    try {
      const state = await loadJob(id);
      console.log(`  ${id}  [${state.stage}]  $${state.cost_usd.toFixed(2)}  "${state.topic_input.topic}"`);
    } catch {
      console.log(`  ${id}  [ERROR: could not load]`);
    }
  }
}

async function cmdApproveReject(status: "approved" | "rejected") {
  const jobId  = args[0];
  const gateId = args[1];
  const notes  = args[2] ?? "";

  if (!jobId || !gateId) {
    console.error(`Usage: cli.ts ${status === "approved" ? "approve" : "reject"} <job-id> <gate-id> ["notes"]`);
    process.exit(1);
  }

  const dir      = jobDir(jobId);
  const filename = `gate_${gateId}.${status}.json`;
  await fs.writeJson(path.join(dir, filename), { status, notes }, { spaces: 2 });
  logger.success("cli", `Gate ${gateId} → ${status}`);
}

function printUsage() {
  console.log(`
Content Generation Bot — CLI

Commands:
  run <topic> [--mode low-cost|premium] [--budget N] [--length N] [--notes "..."]
      Start a new pipeline run for the given topic.

  resume <job-id>
      Resume a paused/failed pipeline from its last stage.

  status <job-id>
      Print the current state of a job.

  list
      List all jobs.

  approve <job-id> <gate-id>
      Approve a pending approval gate.

  reject <job-id> <gate-id> ["reason"]
      Reject a pending approval gate.
  `);
}

main().catch((err) => {
  logger.error("cli", err.message ?? String(err));
  process.exit(1);
});
