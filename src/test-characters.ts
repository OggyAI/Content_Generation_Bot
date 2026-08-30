/**
 * Smoke test for the per-video character designer (no full pipeline).
 *
 *   npx ts-node src/test-characters.ts                 # design cast from the sample script (Claude only, ~$0.02)
 *   npx ts-node src/test-characters.ts --sheets        # also render reference sheets (Replicate, ~$0.04 each)
 *   npx ts-node src/test-characters.ts --script <path> --topic "..."
 */
import path from "path";
import fs from "fs-extra";
import { config } from "./config/defaults";
import { ACTIVE_SERIES } from "./config/series";
import { callClaudeJSON } from "./modules/claude/client";
import { renderCharacterSheet } from "./pipeline/04b-characters";
import {
  buildCharacterDesignSystemPrompt, buildCharacterDesignUserPrompt,
} from "./prompts/characters";
import { TopicBrief, ScriptDraft, ContentPillar, FormatMode } from "./types";

interface DesignedChar { id: string; name: string; role_in_story?: string; blueprint_prompt: string; palette_hex?: string[] }

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const scriptPath = arg("script", path.join(process.cwd(), "samples", "sample-script.txt"))!;
  const topic      = arg("topic", "A baker's nephew in the last hours of Pompeii")!;
  const full_text  = await fs.readFile(scriptPath, "utf-8");

  const brief = { topic, era: "79 AD", setting: "Pompeii", world_context: "Roman coastal city beneath Vesuvius" } as TopicBrief;
  const script = { full_text } as ScriptDraft;
  void ContentPillar; void FormatMode;

  console.log(`\n═══ CHARACTER DESIGN — "${topic}" ═══`);
  console.log(`Max detailed characters: ${config.maxDetailedCharacters}\n`);

  const { data, costUsd } = await callClaudeJSON<{ characters: DesignedChar[] }>(
    buildCharacterDesignSystemPrompt(ACTIVE_SERIES, config.maxDetailedCharacters),
    buildCharacterDesignUserPrompt(brief, script, config.maxDetailedCharacters),
    2000,
    "character-design-test"
  );

  const cast = data.characters ?? [];
  cast.forEach((c, i) => {
    console.log(`${i + 1}. [${c.id}] ${c.name} — ${c.role_in_story ?? ""}`);
    console.log(`   palette: ${(c.palette_hex ?? []).join(" ")}`);
    console.log(`   blueprint: ${c.blueprint_prompt}\n`);
  });

  console.log("═══ CHECKS ═══");
  check(cast.length >= 1 && cast.length <= config.maxDetailedCharacters, `Designed ${cast.length} character(s) (≤ ${config.maxDetailedCharacters})`);
  check(cast.every(c => (c.blueprint_prompt ?? "").length > 20), "Every character has a substantive blueprint");
  check(new Set(cast.map(c => c.id)).size === cast.length, "Character ids are distinct");
  console.log(`Claude cost: ~$${costUsd.toFixed(4)}`);

  if (process.argv.includes("--sheets")) {
    const usingStyle = !!config.styleReferenceImage;
    console.log(`\n═══ REFERENCE SHEETS (${usingStyle ? "Nano Banana + style ref" : "Flux"}) ═══`);
    const dir = path.join(process.cwd(), "output", "_char_test");
    for (const c of cast) {
      const r = await renderCharacterSheet(c.blueprint_prompt, ACTIVE_SERIES.style_anchor, dir, `char_${c.id}_sheet`);
      console.log(`  ${c.name} → ${r.imagePath}  ($${r.costUsd.toFixed(4)})`);
    }
  } else {
    console.log("\n(Run with --sheets to also render the reference sheets.)");
  }
  console.log("");
}

function check(ok: boolean, label: string) { console.log(`  ${ok ? "✅" : "❌"}  ${label}`); }

main().catch(err => { console.error(err); process.exit(1); });
