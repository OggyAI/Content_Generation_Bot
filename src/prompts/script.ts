import { TopicBrief, Outline, OutlineSection, SeriesConfig, EndingMode } from "../types";

/**
 * SCRIPT STAGE PROMPTS — encodes the Master Brief Part 2 script formula.
 * The system prompt is the channel's replicable "engine"; the user prompt binds it
 * to this specific topic, outline, and series, and (optionally) injects the two
 * reference transcripts as VOICE/RHYTHM style references only.
 */

export function buildScriptSystemPrompt(series: SeriesConfig): string {
  const endingRule =
    series.ending_mode === EndingMode.EngagementCTA
      ? `End with, in this order: (a) a single one-sentence "this story is fictional" disclaimer, ` +
        `(b) ONE direct, genuinely arguable moral question fired straight at the viewer to bait comments, ` +
        `(c) the exact line "Subscribe for more. See you in the next one." ` +
        `Build the premise so the closing question has no clean answer.`
      : `End on a poetic loop: a cyclical callback that echoes the opening image. No CTA, no disclaimer, ` +
        `no direct address — let the last line linger.`;

  return `You are a script writer for a second-person POV narrative animation channel. You write a complete narration script that the viewer experiences as the protagonist.

RULES — follow every one:
- Second person, present tense, start to finish ("you..."). Never slip into third person.
- COLD OPEN: open on a hyper-specific concrete action or situation in sentence one. No preamble, no "imagine," no "welcome." Establish age + place + one small relatable/humiliating specific before the tenth second of narration, then immediately deliver the protagonist's core motivation or wound (the "why").
- PROSE: sensory-specific and concrete. Anchor every abstract feeling to a physical image. Use comedic specificity for texture — exact dollar amounts, brand names, oddly precise details.
- BANNED, never use: "little did they know," "you see," "the truth is" (as a crutch), "and that's when everything changed," generic intensifiers (very, really, suddenly), and any cliché or stock phrasing. If a sentence could appear in a thousand other scripts, rewrite it.
- STRUCTURE: an escalation ladder → a midpoint revelation → a NON-OBVIOUS emotional climax. The climax must be a quiet structural turn — a hesitation, an ironic discovery, a thing left unsaid — NEVER the loudest plot event.
- APHORISMS: seed 3–6 short, quotable insight lines spaced through the piece (clean paradox/contrast, e.g. "Control is tension held so tight it looks like peace"). These are the screenshot/comment lines.
- MOTIFS: establish 2–4 concrete recurring objects/sounds/phrases early; pay them off; echo the opening image at the end.
- ${endingRule}
- If reference transcripts are provided, study them for VOICE and RHYTHM ONLY. Never copy their plots, sentences, characters, or phrasings. Produce entirely original work.

OUTPUT: only the narration script. Insert [SCENE: <label>] markers on their own line between scenes, with labels matching the outline section names. No headers, no stage directions, no word counts.`;
}

export function buildScriptUserPrompt(
  brief: TopicBrief,
  outline: Outline,
  series: SeriesConfig,
  wordsPerMinute: number,
  referenceTranscripts: string = ""
): string {
  // Master Brief Part 2.9 — target 1,800–2,800 words; clamp the outline estimate into that band.
  const rawTarget = Math.round(outline.total_est_min * wordsPerMinute);
  const targetWords = Math.min(Math.max(rawTarget, 1800), 2800);
  const minWords = Math.round(targetWords * 0.92);
  const maxWords = Math.round(targetWords * 1.08);

  const outlineText = outline.sections.map(formatSection).join("\n\n");

  const refBlock = referenceTranscripts.trim()
    ? `\n\n## REFERENCE TRANSCRIPTS (study for VOICE & RHYTHM ONLY — do not copy)\n${referenceTranscripts.trim()}\n`
    : `\n\n(No reference transcripts attached. Match the voice described in the rules: poetic, sensory-specific, second-person present tense.)\n`;

  return `## VIDEO DETAILS
TOPIC: "${brief.topic}"
ERA: ${brief.era}
SETTING: ${brief.setting}
OPENING STYLE: ${brief.opening_style}
TONE: ${brief.tone_notes}
WORLD CONTEXT: ${brief.world_context}
SERIES LANE: ${series.lane} (${series.palette_grade})

## LENGTH — HARD CONSTRAINT
- Write ${minWords}–${maxWords} words of narration (target ${targetWords}, ~${Math.round(targetWords / wordsPerMinute)} min at ${wordsPerMinute} wpm).
- Do not exceed ${maxWords} words. Cut, never pad.

## OUTLINE TO FOLLOW
${outlineText}
${refBlock}
Write the full script now. Open on the cold-open line, follow the escalation ladder through the outline, land the non-obvious climax, and close exactly as the ending rule specifies.`;
}

function formatSection(s: OutlineSection): string {
  const moments = s.key_moments.map(m => `  • ${m}`).join("\n");
  return `[${s.label.toUpperCase()}] (~${s.estimated_min} min)
${s.summary}
Key moments:
${moments}`;
}
