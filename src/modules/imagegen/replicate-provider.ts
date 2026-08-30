/**
 * Replicate provider — the automated backbone.
 *
 * When a channel STYLE_REFERENCE_IMAGE is configured, ALL generation routes through
 * Nano Banana conditioned on that style image (+ the character sheet for character
 * scenes) so the whole video matches one flat hand-drawn look. Without a style image,
 * backgrounds use Flux text-to-image and character scenes use the sheet alone.
 */
import fs from "fs-extra";
import { ImageProvider, GenRequest, GenResult } from "./types";
import { generateImageFlux, generateImageNanoBanana } from "../replicate/client";
import { generateImage } from "../stability/client";
import { config } from "../../config/defaults";
import { logger } from "../../utils/logger";

export class ReplicateProvider implements ImageProvider {
  readonly name = "replicate";

  async generateBackground(req: GenRequest): Promise<GenResult> {
    // Backgrounds use Flux text-to-image with the style carried by the ANCHOR TEXT.
    // (Conditioning backgrounds on the style IMAGE made Nano Banana copy its actual
    // content — couch, character, baked-in labels — wholesale into unrelated scenes.)
    return this.textToImage(req, "flux-1.1-pro");
  }

  async generateCharacterScene(req: GenRequest): Promise<GenResult> {
    // Keep only sheets that actually exist on disk (or are URLs); cap at 3 references —
    // beyond that, reference-conditioned models start blending identities.
    const sheets: string[] = [];
    for (const p of req.referenceImagePaths ?? []) {
      if (!p) continue;
      if (/^https?:\/\//i.test(p) || (await fs.pathExists(p))) sheets.push(p);
      if (sheets.length >= 3) break;
    }

    // Character sheets carry both identity AND the locked style, so they go in alone.
    // (Any other reference image risks bleeding its content into the scene.)
    if (sheets.length > 0) {
      const r = await generateImageNanoBanana(req.prompt, sheets, req.outputDir, req.filename);
      return { ...r, provider: this.name, model: config.nanoBananaModel };
    }
    // No sheets → text-to-image using the blueprint baked into the prompt.
    logger.info("imagegen", `  No reference for ${req.filename} — using text-to-image`);
    return this.textToImage(req, "flux-1.1-pro");
  }

  private async textToImage(req: GenRequest, model: string): Promise<GenResult> {
    if (config.replicateApiToken) {
      const r = await generateImageFlux(req.prompt, req.negative ?? "", req.outputDir, req.filename);
      return { ...r, provider: this.name, model };
    }
    // Legacy fallback when no Replicate token is configured.
    const r = await generateImage(req.prompt, req.negative ?? "", req.outputDir, req.filename);
    return { ...r, provider: "stability", model: config.stabilityModel };
  }
}
