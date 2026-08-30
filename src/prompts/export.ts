import { TopicBrief, Outline, ScriptDraft, Classification } from "../types";

export function buildExportMetaPrompt(
  brief: TopicBrief,
  classification: Classification,
  script: ScriptDraft,
  outline: Outline
): string {
  const chapterLabels = outline.sections.map(s =>
    `  ${s.label} (~${s.estimated_min} min)`
  ).join("\n");

  return `You are a YouTube content strategist and SEO copywriter for an immersive POV storytelling channel.

Generate the publishing metadata package for this video.

## VIDEO DETAILS
TOPIC: "${brief.topic}"
ERA: ${brief.era}
PILLAR: ${classification.pillar}
SCRIPT EXCERPT (first 300 words): "${script.full_text.substring(0, 300)}..."
ESTIMATED LENGTH: ${script.estimated_min} minutes

## OUTLINE SECTIONS
${chapterLabels}

## DELIVERABLES REQUIRED

### 1. YouTube Title Options (5 options)
- Channel tone: immersive, second-person or "you" hooks, cinematic
- Include power words: POV, You Are, What Your Life, The Life Of
- 50–70 characters ideal
- Mix of question hooks, statement hooks, and POV hooks

### 2. YouTube Description (~200–250 words)
- First 2 lines visible before "more" — make them hooks
- Summarise the video journey (not spoilers, just intrigue)
- Include 3–5 relevant hashtags at the end
- End with channel value prop (e.g. "Drop into history every week...")

### 3. Tags (15–20 tags)
- Mix of broad (history, pov, storytelling) and specific (topic/era)

### 4. Thumbnail Text Suggestions (3 options)
- Short, punchy, high contrast text overlay ideas
- Each is 2–5 words max
- Format: "MAIN LINE / SUBLINE"

### 5. Chapter Timestamps Draft
- Assign timestamps to each outline section
- Assume a clean start at 0:00
- Use the estimated_min values from the outline

Respond ONLY with valid JSON. No markdown fences.

{
  "title_options": ["<title 1>", ...],
  "description": "<full description>",
  "tags": ["<tag>", ...],
  "thumbnail_prompts": ["<MAIN / SUBLINE>", ...],
  "chapter_timestamps": [
    { "label": "<section label>", "time_sec": <cumulative seconds>, "display": "<M:SS>" }
  ]
}`;
}
