import { ContentPillar, FormatMode } from "../types";

export function buildClassifyPrompt(topic: string, notes?: string): string {
  return `You are a content strategist for an immersive POV storytelling YouTube channel.

Your job: classify the following topic into the correct content pillar and format mode.

TOPIC: "${topic}"
${notes ? `CREATOR NOTES: "${notes}"` : ""}

## CONTENT PILLARS
- history_disaster   → real historical events, disasters, wars, collapses, survival stories
- myth_legend        → mythology, folklore, religious epics, legendary figures
- rank_hierarchy     → systems of rank, progression, hierarchy (military ranks, guild systems, caste structures, secret societies)
- fictional_power    → fictional power-structure stories, espionage, dark organizations, speculative scenarios

## FORMAT MODES
- single_life_arc    → follows one person through a single life/mission/journey arc
                       (most historical POVs, disasters, myth hero journeys)
- multi_rank_stage   → follows a character's progression through multiple ranks, stages, or roles
                       (rank systems, multi-era stories, guild progression, career ladders)

## DECISION LOGIC
Use multi_rank_stage when the topic inherently involves progression through stages/ranks, OR when
covering a system/hierarchy where multiple levels tell a richer story than a single snapshot.
Use single_life_arc for everything else.

Respond ONLY with valid JSON. No markdown. No explanation outside the JSON.

{
  "pillar": "<one of: history_disaster | myth_legend | rank_hierarchy | fictional_power>",
  "format_mode": "<one of: single_life_arc | multi_rank_stage>",
  "era": "<approximate era or time period, e.g. '216 BC', 'Viking Age', 'Cold War era'>",
  "setting": "<specific setting, e.g. 'Ancient Carthage', 'Norse mythology', 'Modern CIA'>",
  "tone_guidance": "<1–2 sentences: what tone this topic calls for — e.g. 'grave and tense with moments of dark humor'>",
  "confidence": <0.0–1.0>,
  "reasoning": "<2–3 sentences explaining your classification choices>"
}`;
}
