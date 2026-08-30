import { SeriesConfig, CharacterRole } from "../types";

/**
 * SCENE ANNOTATION (sentence-level pacing, webcomic style).
 * Segmentation into sentences is deterministic (src/utils/sentence-split.ts); this
 * prompt only ANNOTATES each segment with the fields the visuals/grade/overlay stages
 * need: shot_type, mood, location, character_refs, is_symbolic_insert, sfx, dialogue.
 */
export function buildSceneAnnotationSystemPrompt(series: SeriesConfig, detailedProtagonist = true): string {
  const detailed = series.characters.filter(c => c.role === CharacterRole.Detailed);
  const roster = [
    `  - "${series.protagonist.id}" (PROTAGONIST — the "you" of the story)`,
    ...detailed.map(c => `  - "${c.id}" (${c.name})`),
  ].join("\n");

  const closeUpRule = detailedProtagonist
    ? `close_up is for genuine emotional PEAKS only — a revelation, a hesitation, a reaction that carries the beat. Budget: AT MOST 1 close_up in any 4 consecutive lines (~20% overall). A face on screen constantly loses its power and starves the video of world/context — most lines should be establishing, two_shot or detail_insert.`
    : `never assign close_up (or a face detail_insert) to a line where ONLY the blank protagonist is present — a featureless head shows nothing. close_up is only for a NAMED character's face.`;

  return `You are a storyboard editor for a second-person POV animation channel in an emotional-storytelling webcomic style. You annotate already-segmented narration lines (one line ≈ one image, on screen ~2–5 seconds).

CHARACTER ROSTER (use these exact ids in character_refs):
${roster}
  Anyone else = anonymous black-silhouette crowd; do NOT list them in character_refs.

For EACH numbered line assign:
- shot_type: establishing | two_shot | close_up | detail_insert | symbolic_insert
- mood: one or two words, e.g. celebratory, awkward, reflective, lonely
- location: a short concrete place
- character_refs: array of roster ids visibly present ([] for pure environment/symbolic)
- is_symbolic_insert: true if the line is figurative/metaphorical (render it literally)
- dialogue_text: if this line contains QUOTED SPEECH someone says out loud, the exact spoken words (short — trim to ≤12 words); else ""
- dialogue_side: "left" or "right" — which side of frame the SPEAKER should sit (only when dialogue_text is set)
- sfx_prompt: a SHORT diegetic sound-effect description ONLY when a concrete sound clearly belongs to this beat (e.g. "lively bar chatter and glasses clinking", "morning birdsong", "heavy rain on a window"). Leave "" for most lines — only the strongest 15–25% of beats get SFX. Never narration or music.

SHOT RHYTHM (critical — this is what makes it feel like a film, not a slideshow):
- Vary shot_type constantly; never the same type twice in a row.
- Cut like a conversation: wide establishing to set a place → close_up on whoever the line is about → close_up REACTION of the other person → detail_insert (hands, a drink, a phone) for texture.
- ${closeUpRule}
- Consecutive lines in the same location are the SAME continuous moment seen from different angles — keep location and character_refs consistent across them.

Respond ONLY with valid JSON, no fences:
{"items":[{"i":0,"shot_type":"establishing","mood":"celebratory","location":"warm crowded bar","character_refs":["pov","jack"],"is_symbolic_insert":false,"dialogue_text":"So what about you? What's new?","dialogue_side":"left","sfx_prompt":"lively bar chatter and glasses clinking"}]}`;
}

export function buildSceneAnnotationUserPrompt(lines: Array<{ i: number; text: string }>): string {
  const list = lines.map(l => `${l.i}: ${l.text}`).join("\n");
  return `Annotate these ${lines.length} narration lines:\n\n${list}`;
}
