/**
 * Lightweight Express server for approval gates and job status.
 *
 * Endpoints:
 *   GET  /jobs                   — list all jobs
 *   GET  /jobs/:id               — get job state
 *   GET  /jobs/:id/gates         — list pending approval gates
 *   POST /jobs/:id/gates/:gateId — approve or reject a gate
 *   POST /jobs/run               — start a new pipeline job
 *
 * Run: ts-node src/server/index.ts
 */
import express from "express";
import path from "path";
import fs from "fs-extra";
import { config } from "../config/defaults";
import { listJobs, loadJob, jobDir } from "../utils/job-store";
import { logger } from "../utils/logger";

const app  = express();
const PORT = parseInt(process.env.PORT ?? "3847", 10);

app.use(express.json());

// ─── LIST JOBS ───────────────────────────────────────────────────────────────
app.get("/jobs", async (_req, res) => {
  try {
    const ids = await listJobs();
    const summaries = await Promise.all(
      ids.map(async (id) => {
        try {
          const state = await loadJob(id);
          return {
            job_id:    state.job_id,
            topic:     state.topic_input.topic,
            stage:     state.stage,
            cost_usd:  state.cost_usd,
            updated_at: state.updated_at,
          };
        } catch {
          return { job_id: id, stage: "unknown", error: "Could not load" };
        }
      })
    );
    res.json({ jobs: summaries });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET JOB STATE ───────────────────────────────────────────────────────────
app.get("/jobs/:id", async (req, res) => {
  try {
    const state = await loadJob(req.params.id);
    res.json(state);
  } catch (err) {
    res.status(404).json({ error: `Job not found: ${req.params.id}` });
  }
});

// ─── LIST PENDING GATES ──────────────────────────────────────────────────────
app.get("/jobs/:id/gates", async (req, res) => {
  try {
    const dir   = jobDir(req.params.id);
    const files = await fs.readdir(dir);
    const pending = files.filter(f => f.endsWith(".pending.json"));

    const gates = await Promise.all(
      pending.map(async (f) => {
        const content = await fs.readJson(path.join(dir, f));
        return content;
      })
    );

    res.json({ gates });
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

// ─── APPROVE / REJECT GATE ──────────────────────────────────────────────────
app.post("/jobs/:id/gates/:gateId", async (req, res) => {
  try {
    const { id, gateId } = req.params;
    const { status, notes } = req.body as { status: "approved" | "rejected"; notes?: string };

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    }

    const dir      = jobDir(id);
    const filename = `gate_${gateId}.${status}.json`;
    await fs.writeJson(path.join(dir, filename), { status, notes: notes ?? "" }, { spaces: 2 });

    logger.success("server", `Gate ${gateId} → ${status} (job: ${id})`);
    res.json({ ok: true, gate_id: gateId, status });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── TRIGGER NEW PIPELINE RUN ────────────────────────────────────────────────
app.post("/jobs/run", async (req, res) => {
  try {
    // Lazy import to avoid circular dependency at startup
    const { runPipeline } = await import("../pipeline");
    const input = req.body;

    // Start pipeline in background — don't block the HTTP response
    const jobPromise = runPipeline(input);
    // We need to wait just long enough to get the job_id
    // The pipeline saves state immediately, so we can peek at it
    // For now, return a placeholder and let the pipeline run
    res.json({
      ok: true,
      message: "Pipeline started. Use GET /jobs to monitor.",
      input,
    });

    // Let the pipeline run in the background
    jobPromise.catch((err) => {
      logger.error("server", `Background pipeline failed: ${err}`);
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── SERVE ASSETS (for Shotstack to access local files) ──────────────────────
app.use("/assets", express.static(path.resolve(config.storagePath)));

// ─── START ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.success("server", `Approval server running at http://localhost:${PORT}`);
  logger.info("server", `Serving assets from ${path.resolve(config.storagePath)}`);
  logger.info("server", "Endpoints:");
  logger.info("server", "  GET  /jobs");
  logger.info("server", "  GET  /jobs/:id");
  logger.info("server", "  GET  /jobs/:id/gates");
  logger.info("server", "  POST /jobs/:id/gates/:gateId  { status, notes }");
  logger.info("server", "  POST /jobs/run                { TopicInput }");
});

export { app };
