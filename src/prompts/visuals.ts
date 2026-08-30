import { SceneCard, SeriesConfig, CharacterRole } from "../types";
import { STYLE_LOCK } from "../config/style-lock";

/**
 * VISUAL PROMPT DESIGN (webcomic style).
 * Converts each structured scene card into a vivid, generation-ready image prompt.
 * Character hierarchy: detailed POV lead + detailed side characters (each locked by a
 * reference sheet) against pure matte-black silhouette extras and soft painted backgrounds.
 * Speech bubbles and labels are NOT drawn into the image — they are overlaid at render.
 */

export const CHANNEL_STYLE_TAGS = [
  "webcomic-cartoon",
  "silhouette-extras",
  "soft-painted-background",
  "16:9-widescreen",
  "warm-muted-palette",
  "series-locked-grade",
];

export function buildVisualDesignSystemPrompt(series: SeriesConfig): string {
  const detailed = series.characters.filter(c => c.role === CharacterRole.Detailed);
  const detailedList = detailed.length
    ? detailed.map(c => `  - "${c.id}" (${c.name}): ${c.blueprint_prompt}`).join("\n")
    : "  (none)";

  return `You are a visual prompt engineer for a second-person POV animation channel in an emotional-storytelling webcomic style. You turn structured scene cards into vivid, generation-ready image prompts that all share ONE locked look.

## STYLE ANCHOR (prepend the SPIRIT of this to every prompt; never contradict it)
${series.style_anchor}

## PALETTE LANE
${series.palette_grade}

## CHARACTER HIERARCHY (critical)
- THE POV LEAD ("${series.protagonist.id}"): ${series.protagonist.blueprint_prompt}. His identity is locked by a reference image — describe only his pose, expression and placement for THIS scene, never restate his fixed design.
- SIDE CHARACTERS (identity locked by reference images — describe only pose/expression/placement per scene):
${detailedList}
- EVERYONE ELSE: ${series.crowd_style ?? "pure matte-black featureless silhouettes"}. Never invent extra detailed people — if a scene needs bystanders, they are solid black silhouettes, full stop.
- When two leads share a frame they must stay visually distinct and each on-model with their reference. Emotion lives in FACES and posture — say what each face shows ("eyes wide, forced smile").

## SHOT GRAMMAR
Honour each scene's shot_type: establishing (wide, atmosphere, silhouette crowd fills space), two_shot (both leads at a table/side by side), close_up (one lead's face and shoulders, expression carrying the beat), detail_insert (hands, a drink, a phone — no faces), symbolic_insert (render the figurative line LITERALLY as one conceptual image).

## FRAMING SAFETY (the camera motion will zoom/pan these images — leave margin)
- close_up = CHEST-UP framing with generous headroom: the ENTIRE head fully inside the frame with clear space above the hair. Never crop a head at the hairline or chin, never fill the frame edge-to-edge with a face.
- All shots: keep the key subject away from frame edges; compose with breathing room on every side.

## CONTINUOUS MOMENTS
Scenes marked as inserts (or consecutive scenes in the same location) are the SAME moment covered from different angles, like film coverage: same location, same characters, same lighting — DIFFERENT framing (wide → close-up → reaction → detail). Never repeat the same composition twice in a row.

## RULES
- 40–80 words per prompt. Lead with environment/composition, then figures and their expressions, then lighting/mood.
- Bake the scene's location and mood into concrete, specific imagery.
- The image must contain NO text, NO speech bubbles, NO captions, NO arrows — those are overlaid later.
- Always end with: "flat 2D webcomic cartoon, bold clean line art, soft painted background, 16:9 cinematic, no text, no speech bubbles, no watermark".
- Keep every scene unmistakably the same series (same line style, same palette logic).

Respond ONLY with valid JSON. No markdown fences.`;
}

export function buildVisualDesignUserPrompt(scenes: SceneCard[], series: SeriesConfig): string {
  const negative = STYLE_LOCK.negative_base.join(", ");

  const sceneList = scenes.map(s => {
    const figures = s.character_refs.length ? s.character_refs.join(", ") : "none (environment only)";
    return `Scene ${s.scene_id} [${s.shot_type}]${s.is_insert ? " (insert — same moment as previous, new angle)" : ""}
  location: ${s.location || "(infer from narration)"}
  mood: ${s.mood || "(infer)"}
  characters present: ${figures}
  spoken line (do NOT draw it — bubble is overlaid later): ${s.dialogue_text || "(none)"}
  narration: "${s.narration_text.substring(0, 220)}"`;
  }).join("\n\n");

  return `Design a generation-ready image prompt for each scene below.

${sceneList}

For each scene return its visual_prompt (following all rules and the style anchor) and a negative_prompt.

{
  "scenes": [
    { "scene_id": "<id>", "visual_prompt": "<40-80 word prompt>", "negative_prompt": "${negative}" }
  ]
}`;
}
