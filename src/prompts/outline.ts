import { TopicBrief, FormatMode, OutlineBeatType } from "../types";

export function buildOutlinePrompt(brief: TopicBrief, targetMinutes: number): string {
  const isSingleArc = brief.format_mode === FormatMode.SingleLifeArc;

  const structureGuide = isSingleArc
    ? singleArcStructure(targetMinutes)
    : multiRankStructure(targetMinutes);

  return `You are a scriptwriter and story structure expert for an immersive POV YouTube channel.

Create a detailed video outline based on this brief.

TOPIC: "${brief.topic}"
FORMAT: ${brief.format_mode}
ERA: ${brief.era}
SETTING: ${brief.setting}
WORLD CONTEXT: ${brief.world_context}
TONE: ${brief.tone_notes}
TARGET LENGTH: ~${targetMinutes} minutes

${structureGuide}

## RULES
- Each section must have a clear purpose in the narrative arc
- Include specific key moments (not vague — concrete beats with stakes)
- Pacing should feel cinematic and bingeable, not academic
- Hook must grab in the first 20 seconds
- Ending must be memorable — consequence, legacy, or haunting final image

Respond ONLY with valid JSON. No markdown fences.

{
  "format_mode": "${brief.format_mode}",
  "total_est_min": <number>,
  "sections": [
    {
      "section_id": "<uuid or short id>",
      "index": <0-based number>,
      "label": "<section name>",
      "beat_type": "<hook|entry|daily_life|escalation|turning_point|ending|rank_stage>",
      "summary": "<2–3 sentence summary of what happens in this section>",
      "stage_label": "<ONLY for rank_stage beats — e.g. 'Stage 1: Initiate'>",
      "estimated_min": <number>,
      "key_moments": ["<specific moment 1>", "<specific moment 2>", ...]
    }
  ]
}`;
}

function singleArcStructure(targetMin: number): string {
  return `## STRUCTURE: SINGLE LIFE ARC
Use this beat sequence (adjust timing to fit ${targetMin} min target):

1. HOOK          (~0.5–1 min)   — Plunge into the most gripping moment. Second person, present tense.
2. ENTRY         (~1–1.5 min)   — Who are you? What is your world? What do you want/fear?
3. DAILY_LIFE    (~1.5–2 min)   — The texture of ordinary life in this world. Build immersion.
4. ESCALATION    (~2–3 min)     — Things begin to change. Pressure builds. Stakes revealed.
5. TURNING_POINT (~1.5–2 min)  — The pivot moment. Everything changes for you.
6. ENDING        (~1–1.5 min)   — Consequence, legacy, or haunting final image.`;
}

function multiRankStructure(targetMin: number): string {
  const perStage = (targetMin / 4).toFixed(1);
  return `## STRUCTURE: MULTI-RANK / MULTI-STAGE
Use this sequence:

1. HOOK          (~0.5 min)      — Open on the highest/most dramatic moment first.
2. ENTRY         (~0.5–1 min)    — Set the stakes of the entire system/hierarchy.
3. RANK_STAGE x3–4  (~${perStage} min each) — Each stage = one rank/phase. Include:
                                   - How you enter this stage
                                   - What daily life looks like at this level
                                   - What gets you to the next level (or stops you)
4. TURNING_POINT (~1 min)        — Peak moment — highest rank, or catastrophic failure.
5. ENDING        (~1 min)        — Final consequence, legacy, or reflection.`;
}
