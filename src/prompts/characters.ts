import { TopicBrief, ScriptDraft, SeriesConfig } from "../types";

/**
 * CHARACTER DESIGN (per-video cast).
 * Claude reads the brief + script and designs THIS video's cast fresh every video:
 * the detailed side characters AND (in detailed-protagonist mode) the POV lead himself.
 * The silhouette crowd treatment is a channel constant and is never redesigned.
 */
export function buildCharacterDesignSystemPrompt(
  series: SeriesConfig,
  maxDetailed: number,
  direction = "",
  detailedProtagonist = true
): string {
  const directionBlock = direction.trim()
    ? `\n\nART DIRECTION (override — apply to EVERY character): ${direction.trim()}`
    : "";

  const protagonistSection = detailedProtagonist
    ? `THE POV PROTAGONIST ("you") — design him too, from this foundation:
${series.protagonist.blueprint_prompt}
He is the emotional centre and appears in most shots, so his design must be RELATABLE and understated — an ordinary person the viewer projects onto (think: messy hair, hoodie or plain shirt, soft posture), never flashy or heroic. His design should quietly communicate his personality and situation in THIS story (introvert? overworked? dreamer?). Include role-appropriate clothing/props for this story's setting. Return this as "protagonist_blueprint".`
    : `THE POV PROTAGONIST is a fixed blank faceless figure — do NOT redesign him: ${series.protagonist.blueprint_prompt}
Only decide his COSTUME + props for this story (e.g. "a dark tattered ferryman's robe and a long wooden oar") so his silhouette reads as his role. The head stays a completely blank oval. Return this as "protagonist_costume".`;

  const protagonistJsonField = detailedProtagonist
    ? `"protagonist_blueprint": "<full reusable design for the POV lead, 30-60 words>",`
    : `"protagonist_costume": "<costume + props for the faceless POV figure in THIS story>",`;

  return `You are a character designer for a second-person POV animation channel in an emotional-storytelling webcomic style. Each video has a NEW topic and therefore a NEW cast — never reuse designs between videos.

LOCKED CHANNEL STYLE (every character must fit this look, but each must be visually distinct):
${series.style_anchor}
PALETTE LANE: ${series.palette_grade}${directionBlock}

${protagonistSection}

CROWDS/EXTRAS are always: ${series.crowd_style ?? "pure matte-black featureless silhouettes"} — never design them.

SIDE CHARACTERS: design the 1–${maxDetailed} emotionally central DETAILED side characters this story needs (the friend, the love interest, the antagonist) — only those who genuinely carry the story. Fewer is better.

Every blueprint (protagonist and side characters) must be:
- Versatile & transferable: fixed identity traits (face shape, hair, build, signature clothing, proportion in heads, palette) that stay constant in ANY pose, angle, or scene — so a reference model can reproduce them anywhere.
- PERSONALITY-DRIVEN: the design itself should communicate who they are — posture, clothing, hair and expression tell the viewer "confident extrovert" or "awkward introvert" before a word is spoken. Contrast the leads against each other.
- Specific & distinctive: concrete, memorable, unmistakably this person.
- On-style: flat webcomic cartoon — simple expressive faces, bold clean line art; no photorealism, no anime.
- Self-contained: identity only — no scene, no background, no pose.

Respond ONLY with valid JSON, no fences:
{
  ${protagonistJsonField}
  "characters": [
    {
      "id": "<short_snake_case_id>",
      "name": "<name or role>",
      "role_in_story": "<one line>",
      "blueprint_prompt": "<reusable identity description, 30-60 words>",
      "palette_hex": ["#RRGGBB", "#RRGGBB"]
    }
  ]
}`;
}

export function buildCharacterDesignUserPrompt(brief: TopicBrief, script: ScriptDraft, maxDetailed: number): string {
  return `TOPIC: "${brief.topic}"
ERA: ${brief.era}
SETTING: ${brief.setting}
WORLD: ${brief.world_context}

SCRIPT (design the cast that actually appears in this):
"""
${script.full_text.substring(0, 6000)}
"""

Design the protagonist plus at most ${maxDetailed} detailed side character(s) — only the ones who emotionally drive THIS story. Give each a distinct, reusable, personality-driven blueprint. Return JSON only.`;
}

/**
 * The model-sheet prompt used to render a character's reference sheet from its blueprint.
 * Rich layout (turnaround + expressions + action poses) so downstream reference-conditioned
 * generation has pose and emotion coverage to draw from.
 */
export function buildSheetPrompt(blueprint: string, styleAnchor: string): string {
  return `Character model sheet of ONE character, the SAME character repeated in every panel. ` +
    `Top row — full-body turnaround: front view, three-quarter view, side profile, back view. ` +
    `Middle row — six facial expressions: neutral, slight smile, sad, surprised, annoyed, embarrassed. ` +
    `Bottom row — three action poses: standing relaxed, sitting on a chair, mid-walk. ` +
    `Character: ${blueprint}. ` +
    `Style: ${styleAnchor} ` +
    `If a reference image is provided, use it ONLY for art style (linework, palette, shading) — ` +
    `do NOT copy its people, faces, objects, background or composition. ` +
    `Plain light-grey studio background, even flat lighting, identical proportions, identical outfit and ` +
    `identical hairstyle in every panel, clean and uncluttered layout. No text, no labels, no arrows, no watermark.`;
}
