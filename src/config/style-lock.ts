/**
 * Style-lock configuration.
 * Every visual prompt generated in the pipeline includes these tokens
 * to maintain channel-wide visual consistency.
 */

export interface StyleLock {
  /** Always include in every positive prompt */
  positive_base: string[];
  /** Always include in every negative prompt */
  negative_base: string[];
  /** Per-era overrides */
  era_modifiers: Record<string, string[]>;
  /** Per-pillar mood tokens */
  pillar_moods: Record<string, string[]>;
}

export const STYLE_LOCK: StyleLock = {
  positive_base: [
    "simple minimalist character with blank white oval face and small dot eyes",
    "simple stick figure body with clean line art limbs",
    "characters have no detailed facial features, just dots for eyes and simple mouth",
    "highly detailed illustrated background environment",
    "digital illustration style",
    "clean bold outlines on characters",
    "rich detailed background contrasting with simple characters",
    "widescreen cinematic composition 16:9",
    "atmospheric environment with depth and detail",
    "muted color palette with selective accent colors",
  ],

  negative_base: [
    "photorealistic human face",
    "realistic portrait",
    "detailed facial features",
    "realistic eyes nose mouth",
    "anime eyes",
    "3D render",
    "CGI",
    "watercolor",
    "photograph",
    "multiple styles",
    "low quality",
    "blurry",
    "overexposed",
    "text",
    "speech bubble",
    "caption",
    "watermark",
    "cropped head",
    "cut-off face",
    "extreme close-up filling the frame",
    "logo",
    "border",
    "deformed hands",
  ],

  era_modifiers: {
    "ancient":        ["aged stone textures", "torch-lit", "sandstone", "dusty ochre palette"],
    "medieval":       ["castle stone walls", "candlelit", "forest mist", "muted greens and browns"],
    "early_modern":   ["cobblestone streets", "gas-lamp glow", "fog", "desaturated earth tones"],
    "modern":         ["urban backdrop", "neon accent lighting", "concrete gray", "sharp shadows"],
    "mythological":   ["ethereal golden light", "divine radiance", "otherworldly colour grade", "god rays"],
    "space":          ["void black backdrop", "star field", "spacecraft hull metal", "cool blue lighting"],
    "fantasy":        ["magical particle effects", "arcane glow", "enchanted forest", "jewel-toned palette"],
  },

  pillar_moods: {
    "history_disaster": [
      "tension and dread atmosphere",
      "smoke and chaos in background",
      "warm amber fire glow",
    ],
    "myth_legend": [
      "mythic grandeur",
      "supernatural haze",
      "divine scale contrast between human and environment",
    ],
    "rank_hierarchy": [
      "power and authority visual hierarchy",
      "structured imposing architecture",
      "cold blue-grey tones",
    ],
    "fictional_power": [
      "shadow and secrecy atmosphere",
      "high contrast noir lighting",
      "subtle surveillance element in background",
    ],
  },
};

/**
 * Build the full positive prompt suffix for a given scene.
 */
export function buildStyleSuffix(
  era: string,
  pillar: string,
  extraTags: string[] = []
): { positive: string; negative: string } {
  const eraKey    = era.toLowerCase().replace(/\s+/g, "_");
  const eraTokens = STYLE_LOCK.era_modifiers[eraKey] ?? [];
  const moodTokens = STYLE_LOCK.pillar_moods[pillar] ?? [];

  const positive = [
    ...STYLE_LOCK.positive_base,
    ...eraTokens,
    ...moodTokens,
    ...extraTags,
  ].join(", ");

  const negative = STYLE_LOCK.negative_base.join(", ");

  return { positive, negative };
}
