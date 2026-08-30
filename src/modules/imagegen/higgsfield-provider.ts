/**
 * Higgsfield provider — MANIFEST MODE.
 *
 * The Higgsfield MCP is an interactive OAuth tool and cannot be called from a standalone
 * batch process. So in this mode the visuals stage does not generate images directly;
 * instead each request is appended to <jobDir>/generation_manifest.json. You then fulfil
 * the manifest interactively in a Claude Code chat using the Higgsfield MCP tools
 * (generate_image / create_character / generate_video), save the results into the assets
 * folder with the given filenames, and resume the pipeline.
 */
import path from "path";
import fs from "fs-extra";
import { ImageProvider, GenRequest, GenResult } from "./types";
import { logger } from "../../utils/logger";

interface ManifestEntry {
  filename:            string;
  kind:                "background" | "character";
  suggested_model:    string;
  prompt:              string;
  negative?:           string;
  reference_images?:   string[];
  expected_output:     string;   // where to save the generated file
}

export class HiggsfieldProvider implements ImageProvider {
  readonly name = "higgsfield";

  async generateBackground(req: GenRequest): Promise<GenResult> {
    await this.record(req, "background", "Flux.2 Pro (unlimited on Starter)");
    return this.pending("flux.2-pro");
  }

  async generateCharacterScene(req: GenRequest): Promise<GenResult> {
    const model = req.referenceImagePaths?.length ? "Soul V2 / Nano Banana Pro (create_character)" : "Soul V2";
    await this.record(req, "character", model);
    return this.pending(model);
  }

  private async record(req: GenRequest, kind: ManifestEntry["kind"], suggestedModel: string): Promise<void> {
    const manifestPath = path.join(req.outputDir, "..", "generation_manifest.json");
    const expectedOutput = path.join(req.outputDir, `${req.filename}.jpg`);

    let entries: ManifestEntry[] = [];
    if (await fs.pathExists(manifestPath)) {
      entries = (await fs.readJson(manifestPath).catch(() => [])) as ManifestEntry[];
    }

    entries.push({
      filename:        req.filename,
      kind,
      suggested_model: suggestedModel,
      prompt:          req.prompt,
      negative:        req.negative,
      reference_images: req.referenceImagePaths,
      expected_output: expectedOutput,
    });

    await fs.ensureDir(path.dirname(manifestPath));
    await fs.writeJson(manifestPath, entries, { spaces: 2 });
    logger.info("imagegen", `  [manifest] queued ${req.filename} (${kind} → ${suggestedModel})`);
  }

  private pending(model: string): GenResult {
    return { imagePath: "", costUsd: 0, cached: false, provider: this.name, model, pending: true };
  }
}
