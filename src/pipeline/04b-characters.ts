/**
 * Per-video character design, split into two steps so you can EDIT the cast before
 * any reference sheets are drawn (Master Brief Part 4):
 *
 *   proposeCast → writes an editable cast.json (text blueprints only)  →  gate_cast_design
 *   renderCast  → reads the (possibly edited) cast.json, draws the sheets →  gate_characters
 *
 * The POV protagonist stays FACELESS and gets NO sheet, but is COSTUMED for its role this
 * video (e.g. a ferryman's robe + oar). The blank-head + role costume reads as the character
 * without breaking viewer projection. The generic crowd look is a channel constant.
 */
import path from "path";
import fs from "fs-extra";
import {
  JobState, PipelineStage, CharacterSpec, CharacterRole,
} from "../types";
import { callClaudeJSON } from "../modules/claude/client";
import {
  buildCharacterDesignSystemPrompt, buildCharacterDesignUserPrompt, buildSheetPrompt,
} from "../prompts/characters";
import { generateImageFlux, generateImageNanoBanana } from "../modules/replicate/client";
import { ImageResult } from "../modules/stability/client";
import { ACTIVE_SERIES } from "../config/series";
import { saveJob, jobDir } from "../utils/job-store";
import { logger } from "../utils/logger";
import { config } from "../config/defaults";

interface DesignedChar {
  id: string;
  name: string;
  role_in_story?: string;
  blueprint_prompt: string;
  palette_hex?: string[];
}

/** Editable cast.json entry. role "protagonist" = the faceless POV figure (no sheet, costume only). */
interface CastEntry {
  id: string;
  name: string;
  role?: "protagonist" | "detailed";
  role_in_story?: string;
  blueprint: string;
  palette_hex?: string[];
}

/**
 * Render a reusable reference sheet for a character. If a channel STYLE_REFERENCE_IMAGE
 * is set, generate with Nano Banana conditioned on it (locks the flat hand-drawn look);
 * otherwise fall back to Flux text-to-image. Shared by the pipeline and the smoke test.
 */
export async function renderCharacterSheet(
  blueprint: string, styleAnchor: string, outputDir: string, filename: string
): Promise<ImageResult> {
  const prompt = buildSheetPrompt(blueprint, styleAnchor);
  const style  = config.styleReferenceImage;
  const hasStyle = !!style && (/^https?:\/\//i.test(style) || await fs.pathExists(style));
  return hasStyle
    ? generateImageNanoBanana(prompt, [style], outputDir, filename)
    : generateImageFlux(prompt, "", outputDir, filename);
}

/** Compose the protagonist's per-video blueprint: blank-faceless core + role costume. */
function costumedProtagonist(baseBlueprint: string, costume: string): string {
  const c = costume.trim();
  if (!c) return baseBlueprint;
  return `${baseBlueprint} For THIS story, dressed for the role: ${c}. Keep the head a COMPLETELY blank rounded oval — no eyes, nose, or mouth.`;
}

// ─── STEP 1: PROPOSE CAST (text blueprints + protagonist costume → editable cast.json) ──

export async function proposeCast(state: JobState): Promise<void> {
  if (!state.brief || !state.script) throw new Error("Brief and script required before character design");
  const base = state.series ?? ACTIVE_SERIES;

  let detailed: CastEntry[];
  let protagBlueprint = base.protagonist.blueprint_prompt;

  if (config.autoCharacterDesign) {
    logger.step("characters", "Designing this video's cast (incl. POV lead) from the script...");
    const { data, costUsd } = await callClaudeJSON<{ protagonist_blueprint?: string; protagonist_costume?: string; characters: DesignedChar[] }>(
      buildCharacterDesignSystemPrompt(base, config.maxDetailedCharacters, config.characterDirection, config.protagonistDetailed),
      buildCharacterDesignUserPrompt(state.brief, state.script, config.maxDetailedCharacters),
      2000,
      "character-design"
    );
    state.cost_usd += costUsd;
    if (config.protagonistDetailed) {
      // Detailed webcomic lead — a full per-story design (falls back to the series base spec).
      protagBlueprint = (data.protagonist_blueprint ?? "").trim() || base.protagonist.blueprint_prompt;
    } else {
      // Blank faceless lead — only costumed for the role.
      protagBlueprint = costumedProtagonist(base.protagonist.blueprint_prompt, (data.protagonist_costume ?? "").trim());
    }
    detailed = (data.characters ?? [])
      .slice(0, config.maxDetailedCharacters)
      .map(d => ({
        id:           sanitizeId(d.id || d.name),
        name:         d.name || "",
        role:         "detailed" as const,
        role_in_story: d.role_in_story,
        blueprint:    d.blueprint_prompt || "",
        palette_hex:  d.palette_hex,
      }))
      .filter(e => e.blueprint.trim());
  } else {
    detailed = base.characters.map(c => ({
      id: c.id, name: c.name, role: "detailed" as const, blueprint: c.blueprint_prompt, palette_hex: c.palette_hex,
    }));
  }

  // Write the EDITABLE cast file: protagonist first, then detailed side characters.
  const protagonistEntry: CastEntry = {
    id: base.protagonist.id,
    name: config.protagonistDetailed ? "You — the POV lead" : "You — the POV lead (faceless, no sheet drawn)",
    role: "protagonist", blueprint: protagBlueprint,
  };
  const castPath = path.join(jobDir(state.job_id), "cast.json");
  await fs.writeJson(castPath, [protagonistEntry, ...detailed], { spaces: 2 });

  // Stash provisional specs on state (no sheets yet) so the gate preview has data.
  state.series = {
    ...base,
    protagonist: { ...base.protagonist, blueprint_prompt: protagBlueprint },
    characters: detailed.map(e => ({
      id: e.id, name: e.name, role: CharacterRole.Detailed,
      blueprint_prompt: e.blueprint, reference_sheet_url: "", palette_hex: e.palette_hex,
    })),
  };
  state.cast_proposed = true;
  state.stage         = PipelineStage.CastDesigned;
  await saveJob(state);

  logger.success("characters",
    `Proposed POV lead + ${detailed.length} side character(s). Edit ${castPath} to tweak any look, then approve.`);
}

// ─── STEP 2: RENDER SHEETS (from the edited cast.json) ───────────────────────────

export async function renderCast(state: JobState): Promise<void> {
  const base = state.series ?? ACTIVE_SERIES;
  const castPath = path.join(jobDir(state.job_id), "cast.json");

  // Read the (possibly user-edited) cast file; fall back to state's provisional specs.
  let entries: CastEntry[];
  if (await fs.pathExists(castPath)) {
    entries = (await fs.readJson(castPath).catch(() => [])) as CastEntry[];
  } else {
    entries = base.characters.map(c => ({ id: c.id, name: c.name, role: "detailed" as const, blueprint: c.blueprint_prompt, palette_hex: c.palette_hex }));
  }
  entries = (entries ?? []).filter(e => e && (e.blueprint ?? "").trim());

  const protagEntry = entries.find(e => e.role === "protagonist" || e.id === base.protagonist.id);
  const detailed    = entries.filter(e => e !== protagEntry);
  let protagonist: CharacterSpec = protagEntry?.blueprint?.trim()
    ? { ...base.protagonist, blueprint_prompt: protagEntry.blueprint }
    : (state.series?.protagonist ?? base.protagonist);

  const charsDir = path.join(jobDir(state.job_id), "assets", "characters");

  // Detailed-protagonist mode: the POV lead gets his own reference sheet so he stays
  // on-model across every scene (he appears in most shots). Blank mode: no sheet needed.
  if (config.protagonistDetailed && protagonist.blueprint_prompt.trim()) {
    try {
      const r = await renderCharacterSheet(protagonist.blueprint_prompt, base.style_anchor, charsDir, "char_pov_sheet");
      protagonist = { ...protagonist, reference_sheet_url: r.imagePath };
      state.cost_usd += r.costUsd;
      logger.success("characters", `Reference sheet for POV lead: ${path.basename(r.imagePath)}`);
    } catch (err) {
      logger.warn("characters", `POV sheet failed (${(err as Error).message}) — protagonist scenes fall back to text-only`);
    }
  }

  logger.step("characters", `Rendering reference sheets for ${detailed.length} side character(s)...`);
  const cast: CharacterSpec[] = [];

  for (const e of detailed) {
    const id = sanitizeId(e.id || e.name);
    let sheetPath = "";
    try {
      const r = await renderCharacterSheet(e.blueprint, base.style_anchor, charsDir, `char_${id}_sheet`);
      sheetPath = r.imagePath;
      state.cost_usd += r.costUsd;
      logger.success("characters", `Reference sheet for ${e.name || id}: ${path.basename(sheetPath)}`);
    } catch (err) {
      logger.warn("characters", `Sheet failed for ${e.name || id} (${(err as Error).message}) — scenes will fall back to text-only`);
    }
    cast.push({
      id, name: e.name || id, role: CharacterRole.Detailed,
      blueprint_prompt: e.blueprint, reference_sheet_url: sheetPath, palette_hex: e.palette_hex,
    });
  }

  state.series     = { ...base, protagonist, characters: cast };
  state.cast_ready = true;
  state.stage      = PipelineStage.CharactersDesigned;
  await saveJob(state);

  const withSheets = cast.filter(c => c.reference_sheet_url).length;
  const povNote = protagonist.reference_sheet_url ? "sheeted POV lead" : "faceless POV lead";
  logger.success("characters", `Cast ready: ${povNote} + ${cast.length} side (${withSheets} with sheets) + silhouette crowds`);
}

function sanitizeId(s: string): string {
  return (s || "char").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 24) || "char";
}
