/**
 * Cost estimation constants (USD) per unit.
 * These are approximate — update as pricing changes.
 */

export const COST_RATES = {
  // Claude API (per 1M tokens — Opus 4.6)
  claude_input_per_1m:   15.00,
  claude_output_per_1m:  75.00,

  // ElevenLabs (per 1000 characters)
  elevenlabs_per_1k_chars: 0.30,

  // Stability AI (per image)
  stability_per_image: 0.04,

  // Runway Gen-3 Alpha Turbo (per 5-second clip)
  runway_per_5s_clip: 0.50,

  // Shotstack (per second of rendered video)
  shotstack_per_second: 0.009,   // ~$0.54 for 60s
};

export interface CostBreakdown {
  claude_usd:       number;
  elevenlabs_usd:   number;
  images_usd:       number;
  video_clips_usd:  number;
  render_usd:       number;
  total_usd:        number;
}

export function estimateCost(params: {
  totalTokensIn:  number;
  totalTokensOut: number;
  totalChars:     number;
  numImages:      number;
  numVideoClips:  number;
  renderDurationSec: number;
}): CostBreakdown {
  const claude_usd = (params.totalTokensIn / 1_000_000) * COST_RATES.claude_input_per_1m
                   + (params.totalTokensOut / 1_000_000) * COST_RATES.claude_output_per_1m;

  const elevenlabs_usd = (params.totalChars / 1000) * COST_RATES.elevenlabs_per_1k_chars;

  const images_usd = params.numImages * COST_RATES.stability_per_image;

  const video_clips_usd = params.numVideoClips * COST_RATES.runway_per_5s_clip;

  const render_usd = params.renderDurationSec * COST_RATES.shotstack_per_second;

  return {
    claude_usd,
    elevenlabs_usd,
    images_usd,
    video_clips_usd,
    render_usd,
    total_usd: claude_usd + elevenlabs_usd + images_usd + video_clips_usd + render_usd,
  };
}
