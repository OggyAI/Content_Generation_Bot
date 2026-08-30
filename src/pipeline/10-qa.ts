import { v4 as uuid } from "uuid";
import { JobState, QAReport, QACheck, PipelineStage, AssetType } from "../types";
import { saveJob } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";

export async function runQA(state: JobState): Promise<QAReport> {
  logger.step("qa", "Running QA checks...");

  const checks: QACheck[] = [
    checkRuntime(state),
    checkSceneCount(state),
    checkSubtitleOverflow(state),
    checkDuplicatePrompts(state),
    checkDuplicateScenes(state),
    checkStyleConsistency(state),
    checkVoiceChunkTiming(state),
    checkMissingAssets(state),
    checkBudget(state),
    checkSceneDurations(state),
  ];

  const passed = checks.every(c => c.severity !== "error" || c.passed);

  const report: QAReport = {
    report_id:  uuid(),
    job_id:     state.job_id,
    passed,
    checks,
    created_at: new Date().toISOString(),
  };

  state.qa_report = report;
  state.stage     = PipelineStage.QADone;
  await saveJob(state);

  const errors   = checks.filter(c => !c.passed && c.severity === "error").length;
  const warnings = checks.filter(c => !c.passed && c.severity === "warning").length;
  const info     = checks.filter(c => !c.passed && c.severity === "info").length;

  if (passed) {
    logger.success("qa", `All critical checks passed (${warnings} warnings, ${info} info)`);
  } else {
    logger.error("qa", `QA FAILED — ${errors} errors, ${warnings} warnings`);
    for (const c of checks.filter(c => !c.passed)) {
      logger.warn("qa", `  [${c.severity}] ${c.label}: ${c.detail}`);
    }
  }

  return report;
}

// ─── INDIVIDUAL CHECKS ──────────────────────────────────────────────────────

function checkRuntime(state: JobState): QACheck {
  const script = state.script;
  if (!script) return fail("runtime", "No script found", "error");

  const min = script.estimated_min;
  const tooShort = min < config.targetRuntimeMin * 0.75;
  const tooLong  = min > config.targetRuntimeMax * 1.25;

  if (tooShort) return fail("runtime", `Script ~${min.toFixed(1)} min — too short (target: ${config.targetRuntimeMin}–${config.targetRuntimeMax} min)`, "error");
  if (tooLong)  return fail("runtime", `Script ~${min.toFixed(1)} min — too long (target: ${config.targetRuntimeMin}–${config.targetRuntimeMax} min)`, "warning");
  return pass("runtime", `Script ~${min.toFixed(1)} min — within target range`);
}

function checkSceneCount(state: JobState): QACheck {
  const count = state.scenes?.length ?? 0;
  if (count < config.minScenes) return fail("scene-count", `Only ${count} scenes (min: ${config.minScenes})`, "error");
  if (count > config.maxScenes) return fail("scene-count", `${count} scenes exceeds max ${config.maxScenes}`, "warning");
  return pass("scene-count", `${count} scenes — OK`);
}

function checkSubtitleOverflow(state: JobState): QACheck {
  const MAX_LINE_LENGTH = 50;
  const issues: string[] = [];

  for (const scene of state.scenes ?? []) {
    const lines = scene.subtitle_text.split("\n");
    for (const line of lines) {
      if (line.length > MAX_LINE_LENGTH) {
        issues.push(`Scene ${scene.scene_id}: "${line.substring(0, 30)}..." (${line.length} chars)`);
      }
    }
  }

  if (issues.length > 0) return fail("subtitle-overflow", `${issues.length} subtitle lines exceed ${MAX_LINE_LENGTH} chars`, "warning");
  return pass("subtitle-overflow", "All subtitle lines within length limits");
}

function checkDuplicatePrompts(state: JobState): QACheck {
  const prompts = (state.scenes ?? []).map(s => s.visual_prompt.trim().toLowerCase());
  const seen    = new Set<string>();
  const dupes: string[] = [];

  for (const p of prompts) {
    if (p && seen.has(p)) dupes.push(p.substring(0, 60));
    seen.add(p);
  }

  if (dupes.length > 0) return fail("duplicate-prompts", `${dupes.length} duplicate visual prompts found`, "warning");
  return pass("duplicate-prompts", "No duplicate visual prompts");
}

function checkDuplicateScenes(state: JobState): QACheck {
  const texts = (state.scenes ?? []).map(s => s.narration_text.trim().toLowerCase());
  const seen  = new Set<string>();
  let dupes   = 0;

  for (const t of texts) {
    if (t && seen.has(t)) dupes++;
    seen.add(t);
  }

  if (dupes > 0) return fail("duplicate-scenes", `${dupes} scenes have identical narration text`, "error");
  return pass("duplicate-scenes", "No duplicate scene narration");
}

function checkStyleConsistency(state: JobState): QACheck {
  const scenes = state.scenes ?? [];

  // Empty/too-short prompts indicate a failed prompt-design pass.
  const emptyPrompts = scenes.filter(s => !s.visual_prompt || s.visual_prompt.trim().length < 10);
  if (emptyPrompts.length > 0) {
    return fail("style-consistency", `${emptyPrompts.length} scenes have empty/too-short visual prompts`, "warning");
  }

  // Shot grammar should vary (Master Brief Part 3.3).
  const shotTypes = new Set(scenes.map(s => s.shot_type));
  if (scenes.length >= 4 && shotTypes.size < 2) {
    return fail("style-consistency", `Low shot-type variety — only ${shotTypes.size} type across ${scenes.length} scenes`, "warning");
  }
  return pass("style-consistency", `Prompts present; ${shotTypes.size} shot types in use`);
}

function checkVoiceChunkTiming(state: JobState): QACheck {
  const scenes = state.scenes ?? [];
  if (scenes.length === 0) return fail("voice-timing", "No scenes to time", "error");

  // Every scene should carry an audio-derived span.
  const untimed = scenes.filter(s => s.start_sec == null || s.duration_sec == null);
  if (untimed.length > 0) {
    return fail("voice-timing", `${untimed.length} scenes have no audio-derived timing`, "warning");
  }

  // Consecutive scenes should be continuous (no drift between image window and audio).
  let maxGap = 0;
  for (let i = 1; i < scenes.length; i++) {
    const prevEnd  = scenes[i - 1].end_sec ?? 0;
    const curStart = scenes[i].start_sec ?? 0;
    maxGap = Math.max(maxGap, Math.abs(curStart - prevEnd));
  }
  if (maxGap > 0.5) {
    return fail("voice-timing", `Max gap/overlap between scenes is ${maxGap.toFixed(2)}s`, "warning");
  }
  return pass("voice-timing", `Scene timings continuous (max gap ${maxGap.toFixed(2)}s)`);
}

function checkMissingAssets(state: JobState): QACheck {
  const scenes  = state.scenes ?? [];
  const missing = scenes.filter(s => !s.asset_url || s.asset_type === AssetType.Placeholder);

  if (missing.length > 0) return fail("missing-assets", `${missing.length} scenes have no generated asset`, "error");
  return pass("missing-assets", "All scenes have assets");
}

function checkBudget(state: JobState): QACheck {
  const budget = state.topic_input.budget_usd ?? config.budgetUsd;
  if (state.cost_usd > budget) {
    return fail("budget", `Total cost $${state.cost_usd.toFixed(2)} exceeds budget $${budget.toFixed(2)}`, "warning");
  }
  return pass("budget", `Total cost $${state.cost_usd.toFixed(2)} within $${budget.toFixed(2)} budget`);
}

function checkSceneDurations(state: JobState): QACheck {
  const scenes = state.scenes ?? [];
  const over = scenes.filter(s => (s.duration_sec ?? s.duration_estimate) > config.maxSceneDurationSec);

  // Exceeding MAX is the hard guardrail (would mean an image held too long).
  if (over.length > 0) {
    return fail("scene-durations", `${over.length} scenes exceed MAX ${config.maxSceneDurationSec}s`, "warning");
  }
  return pass("scene-durations", `All ${scenes.length} scenes ≤ ${config.maxSceneDurationSec}s`);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function pass(label: string, detail: string): QACheck {
  return { check_id: uuid(), label, passed: true, severity: "info", detail };
}

function fail(label: string, detail: string, severity: "error" | "warning" | "info"): QACheck {
  return { check_id: uuid(), label, passed: false, severity, detail };
}
