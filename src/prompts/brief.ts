import { Classification } from "../types";

export function buildBriefPrompt(topic: string, classification: Classification): string {
  return `You are a senior content researcher for an immersive POV YouTube channel.

Generate a detailed topic brief for the following video.

TOPIC: "${topic}"
PILLAR: ${classification.pillar}
FORMAT MODE: ${classification.format_mode}
ERA: ${classification.era ?? "unknown"}
SETTING: ${classification.setting ?? "unknown"}
TONE: ${classification.tone_guidance}

## BRIEF REQUIREMENTS
- 4–8 key historical/contextual facts (accurate, engaging)
- 3–5 key figures or archetypes relevant to the story
- Visual palette guidance (mood, colour temperature, lighting style)
- Suggested opening style (choose ONE):
  A: "POV: You are [role]..."
  B: "This is what your life would be like as [role]..."
  C: "It's the year [XXXX]. You are [context]..."
- 1–2 paragraph world-context setting the scene for the scriptwriter
- Tone notes: how to balance entertainment vs accuracy, any pitfalls to avoid

Respond ONLY with valid JSON. No markdown fences. No explanation outside the JSON.

{
  "era": "<confirmed era>",
  "setting": "<confirmed setting>",
  "key_facts": ["<fact 1>", "<fact 2>", ...],
  "key_figures": ["<figure or archetype 1>", ...],
  "tone_notes": "<paragraph on tone>",
  "opening_style": "<chosen opening line or template>",
  "world_context": "<1–2 paragraph world-building context>",
  "visual_palette": "<mood, colours, lighting style — e.g. 'dusty amber, torch light, deep shadows, smoke haze'>"
}`;
}
