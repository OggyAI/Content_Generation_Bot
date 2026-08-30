/**
 * SERIES LOCK — the per-series creative decisions (Master Brief Part 3, Part 11 steps 2–4).
 *
 * Lock these ONCE per series and every video inherits them: the palette lane, the
 * style-anchor paragraph, the crowd (silhouette) treatment, and the base protagonist spec.
 * The named cast — including the protagonist's per-story look when PROTAGONIST_DETAILED
 * is on — is regenerated per video by the character-design stage.
 *
 * ACTIVE STYLE: "emotional-storytelling webcomic" — flat 2D cartoon with expressive,
 * detailed leads, pure matte-black silhouette extras, and soft hand-painted backgrounds
 * (the bar-scene reference look: warm, muted, memory-like).
 */
import {
  SeriesConfig, SeriesLane, EndingMode, CharacterRole,
} from "../types";

// ─── PALETTE GRADE PRESETS (Master Brief Part 3.2) ──────────────────────────────
export const LANE_GRADES: Record<SeriesLane, string> = {
  [SeriesLane.WarmCinematic]:
    "warm muted palette — beige, brown, grey, soft yellow — slightly faded like a memory; " +
    "shift cool blue-grey for loss and lonely night scenes, warm lamplight for intimacy",
  [SeriesLane.DesaturatedGrim]:
    "uniformly desaturated grim grade, cold steel-grey and muted blue, low saturation, " +
    "heavy shadow, single restrained accent colour per scene",
};

// Channel-constant crowd treatment. THE signature device of the webcomic style: every
// person who is not a lead is a PURE MATTE-BLACK SILHOUETTE — no face, no features, no
// outline detail — so the detailed leads pop and the extras read as "everyone else".
export const CROWD_STYLE =
  "every background/minor person is a PURE MATTE-BLACK SILHOUETTE — completely solid black, " +
  "no facial features, no clothing detail, only a clean readable body shape and posture; " +
  "silhouettes may hold objects (glasses, phones) which stay black too";

// ─── THE ACTIVE SERIES (channel style lock) ──────────────────────────────────────
// When AUTO_CHARACTER_DESIGN=true the `characters` array below is IGNORED and a fresh
// cast is generated per video; it is only used as a fallback when auto-design is off.
export const ACTIVE_SERIES: SeriesConfig = {
  series_id: "pov-webcomic-v2",

  lane:          SeriesLane.WarmCinematic,
  palette_grade: LANE_GRADES[SeriesLane.WarmCinematic],
  ending_mode:   EndingMode.EngagementCTA,
  crowd_style:   CROWD_STYLE,

  // One paragraph, prepended to EVERY prompt so all scenes share the look.
  // Target: the "emotional-storytelling webcomic" reference (bar-scene frames).
  style_anchor:
    "Clean flat 2D digital cartoon in an emotional-storytelling webcomic style. Bold, even, " +
    "dark hand-inked outlines; characters have simple but highly expressive faces (large round " +
    "eyes, simple mouths, readable emotion) with flat pale skin and minimal cel-shading. " +
    "Backgrounds are soft, hand-painted and lightly textured in a warm muted palette (beige, " +
    "brown, grey, soft yellow), slightly faded like a memory, with real depth and cinematic " +
    "lighting. STRICT CHARACTER HIERARCHY: only the leads are drawn in detail — every other " +
    "person is a pure matte-black featureless silhouette. Strictly 2D — no 3D render, no anime, " +
    "no photorealism, no glossy shading. Cinematic 16:9. No text, no speech bubbles, no watermark.",

  // Base protagonist spec. With PROTAGONIST_DETAILED=true (default) the character stage
  // designs a full relatable lead per story from this foundation and draws him a reference
  // sheet. With PROTAGONIST_DETAILED=false this exact blank figure is used instead.
  protagonist: {
    id:   "pov",
    name: "You",
    role: CharacterRole.Protagonist,
    blueprint_prompt:
      "a relatable everyman lead in flat webcomic cartoon style: simple expressive face with " +
      "large readable eyes, ordinary build, unassuming posture; design communicates personality " +
      "through hair, clothing and body language; deliberately ordinary so the viewer projects onto him",
  },

  // Fallback cast — used only when AUTO_CHARACTER_DESIGN=false.
  characters: [
    {
      id:   "friend",
      name: "The Friend",
      role: CharacterRole.Detailed,
      blueprint_prompt:
        "a confident, put-together friend in flat webcomic cartoon style: short dark hair, " +
        "buttoned shirt with rolled sleeves, open expressive gestures, easy smile, " +
        "roughly 6.5 heads tall, warm muted palette",
      reference_sheet_url: "",
      palette_hex: ["#8a715a", "#c9b79a", "#3d3a36"],
    },
  ],
};
