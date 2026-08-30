/**
 * Shotstack video assembly client.
 * Converts a RenderPlan into a Shotstack edit JSON and submits it for rendering.
 */
import axios from "axios";
import path from "path";
import fs from "fs-extra";
import { config } from "../../config/defaults";
import { withRetry, sleep } from "../../utils/retry";
import { logger } from "../../utils/logger";
import { RenderPlan, RenderClip, TransitionType, CameraMotion } from "../../types";

// Shotstack environments map to URL segments: sandbox = "stage", production = "v1".
// Accept friendly aliases ("production") and translate to the real path.
const SHOTSTACK_VERSION = ["production", "prod", "v1"].includes(config.shotstackEnv.toLowerCase()) ? "v1" : "stage";
const BASE_URL      = `https://api.shotstack.io/${SHOTSTACK_VERSION}`;
const POLL_INTERVAL = 10_000;
const MAX_POLLS     = Math.max(6, Math.ceil((config.renderPollMinutes * 60_000) / POLL_INTERVAL));

export interface RenderResult {
  videoUrl: string;
  costUsd:  number;
}

export async function submitRender(plan: RenderPlan): Promise<string> {
  const edit = buildShotstackEdit(plan);

  // Debug: save the edit JSON so we can inspect it
  const payload = { timeline: edit.timeline, output: edit.output };
  const debugPath = require("path").join(require("./../../utils/job-store").jobDir(plan.job_id), "shotstack_debug.json");
  require("fs-extra").writeJsonSync(debugPath, payload, { spaces: 2 });
  logger.info("shotstack", `Debug edit JSON saved to: ${debugPath}`);

  return withRetry(async () => {
    logger.step("shotstack", `Submitting render: ${plan.render_plan_id}`);

    try {
      const response = await axios.post(
        `${BASE_URL}/render`,
        payload,
        {
          headers: {
            "x-api-key": config.shotstackApiKey,
            "Content-Type": "application/json",
          },
        }
      );

      const renderId = response.data.response.id as string;
      logger.success("shotstack", `Render submitted: ${renderId}`);
      return renderId;
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
      logger.error("shotstack", `Shotstack error detail:\n${detail}`);
      throw new Error(`Request failed with status code ${err.response?.status ?? "unknown"}`);
    }
  }, "Shotstack:submit");
}

export async function pollRender(renderId: string): Promise<RenderResult> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await sleep(POLL_INTERVAL);

    const response = await axios.get(`${BASE_URL}/render/${renderId}`, {
      headers: { "x-api-key": config.shotstackApiKey },
    });

    const { status, url } = response.data.response;
    logger.info("shotstack", `Render ${renderId}: ${status} (poll ${attempt + 1})`);

    if (status === "done") {
      const costUsd = 0.009 * (response.data.response.data?.duration ?? 0);
      logger.success("shotstack", `Render complete: ${url}`);
      return { videoUrl: url, costUsd };
    }

    if (status === "failed") {
      throw new Error(`Shotstack render failed: ${JSON.stringify(response.data.response)}`);
    }
  }

  throw new Error(`Shotstack render ${renderId} timed out`);
}

export async function downloadRender(videoUrl: string, outputPath: string): Promise<void> {
  logger.step("shotstack", `Downloading render to ${outputPath}`);
  const response = await axios.get(videoUrl, { responseType: "arraybuffer" });
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, Buffer.from(response.data));
  logger.success("shotstack", `Downloaded to ${outputPath}`);
}

// ─── EDIT BUILDER ─────────────────────────────────────────────────────────────

function buildShotstackEdit(plan: RenderPlan): Record<string, unknown> {
  const videoTrack    = plan.tracks.find(t => t.track_type === "video");
  const narrationTrack= plan.tracks.find(t => t.track_type === "audio_narration");
  const sfxTrack      = plan.tracks.find(t => t.track_type === "audio_sfx");
  const subtitleTrack = plan.tracks.find(t => t.track_type === "subtitle");
  const bubbleTrack   = plan.tracks.find(t => t.track_type === "overlay_bubble");
  const labelTrack    = plan.tracks.find(t => t.track_type === "overlay_label");

  const tracks: unknown[] = [];

  // NOTE: in Shotstack, EARLIER tracks render ON TOP of later ones — overlays first.
  // Comic overlays (topmost): labels, then speech bubbles
  if (labelTrack && labelTrack.clips.length > 0) {
    tracks.push({ clips: labelTrack.clips.map(c => buildOverlayClip(c, "label")) });
  }
  if (bubbleTrack && bubbleTrack.clips.length > 0) {
    tracks.push({ clips: bubbleTrack.clips.map(c => buildOverlayClip(c, "bubble")) });
  }

  // Subtitle track (above video)
  if (subtitleTrack && subtitleTrack.clips.length > 0) {
    tracks.push({
      clips: subtitleTrack.clips.map(buildSubtitleClip),
    });
  }

  // Video track (bottom visual layer)
  if (videoTrack) {
    tracks.push({
      clips: videoTrack.clips.map(buildVideoClip),
    });
  }

  // Narration audio track (layer 3 — each scene's voiceover as individual clips)
  if (narrationTrack && narrationTrack.clips.length > 0) {
    tracks.push({
      clips: narrationTrack.clips
        .filter(c => c.asset_url)
        .map(c => ({
          asset: {
            type:   "audio",
            src:    c.asset_url,
            volume: 1,
          },
          start:  c.start,
          length: c.length,
        })),
    });
  }

  // SFX audio track (layer 4 — scene-matched effects mixed low under narration)
  if (sfxTrack && sfxTrack.clips.length > 0) {
    tracks.push({
      clips: sfxTrack.clips
        .filter(c => c.asset_url)
        .map(c => ({
          asset:  { type: "audio", src: c.asset_url, volume: config.sfxVolume },
          start:  c.start,
          length: c.length,
        })),
    });
  }

  return {
    timeline: {
      tracks,
    },
    output: {
      format:     plan.output_format,
      resolution: plan.resolution,
      fps:        plan.fps,
    },
  };
}

function buildVideoClip(clip: RenderClip): unknown {
  const effect = mapCameraMotionToEffect(clip.effect);
  const result: Record<string, unknown> = {
    asset: {
      type: "image",
      src:  clip.asset_url,
    },
    start:  clip.start,
    length: clip.length,
  };
  if (effect) result.effect = effect;
  if (clip.filter && VALID_FILTERS.has(clip.filter)) result.filter = clip.filter;
  if (clip.transition) result.transition = { in: mapTransition(clip.transition) };
  return result;
}

// Valid Shotstack clip colour-grade filters
const VALID_FILTERS = new Set([
  "boost", "contrast", "darken", "greyscale", "lighten", "muted", "negative",
]);

function buildSubtitleClip(clip: RenderClip): unknown {
  return {
    asset: {
      type:       "html",
      html:       `<p>${clip.subtitle_text ?? ""}</p>`,
      css:        subtitleCSS(),
      width:      1100,
      height:     200,
      position:   "bottom",
    },
    start:  clip.start,
    length: clip.length,
    offset: { y: -0.1 },
    opacity: clip.opacity ?? 1,
  };
}

function subtitleCSS(): string {
  return `p {
    font-family: 'Montserrat', sans-serif;
    font-size: 42px;
    font-weight: 700;
    color: #ffffff;
    text-align: center;
    text-shadow: 2px 2px 6px rgba(0,0,0,0.9), -1px -1px 4px rgba(0,0,0,0.8);
    line-height: 1.35;
    padding: 0 20px;
  }`;
}

// ─── COMIC OVERLAYS (webcomic style: speech bubbles + name/age labels) ─────────

function buildOverlayClip(clip: RenderClip, kind: "bubble" | "label"): unknown {
  const isBubble = kind === "bubble";
  const html = isBubble
    ? `<div class="bubble"><p>${escapeHtml(clip.subtitle_text ?? "")}</p></div>`
    : `<div class="label"><p>${escapeHtml(clip.subtitle_text ?? "")}</p><p class="arrow">&#8600;</p></div>`;

  return {
    asset: {
      type:     "html",
      html,
      css:      isBubble ? bubbleCSS() : labelCSS(),
      width:    isBubble ? 560 : 240,
      height:   isBubble ? 190 : 150,
      position: "top",
    },
    start:  clip.start,
    length: clip.length,
    offset: { x: clip.offset_x ?? 0, y: clip.offset_y ?? -0.06 },
    opacity: clip.opacity ?? 1,
  };
}

/** Comic speech bubble: rounded white box, dark hand-inked border, casual font. */
function bubbleCSS(): string {
  return `.bubble {
    display: inline-block;
    background: #ffffff;
    border: 5px solid #1a1a1a;
    border-radius: 46px;
    padding: 18px 30px;
  }
  .bubble p {
    font-family: 'Montserrat', sans-serif;
    font-size: 34px;
    font-weight: 700;
    color: #1a1a1a;
    text-align: center;
    line-height: 1.25;
    margin: 0;
  }`;
}

/** First-appearance label ("23", "Jack") with a small arrow toward the character. */
function labelCSS(): string {
  return `.label p {
    font-family: 'Montserrat', sans-serif;
    font-size: 46px;
    font-weight: 700;
    color: #1a1a1a;
    text-align: center;
    text-shadow: 0 0 8px rgba(255,255,255,0.95), 0 0 4px rgba(255,255,255,0.95);
    margin: 0;
    line-height: 1.1;
  }
  .label p.arrow {
    font-size: 52px;
    margin-top: 2px;
  }`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Valid Shotstack effects (from their API docs):
// zoomIn, zoomInSlow, zoomInFast, zoomOut, zoomOutSlow, zoomOutFast,
// slideLeft, slideLeftSlow, slideLeftFast, slideRight, slideRightSlow, slideRightFast,
// slideUp, slideUpSlow, slideUpFast, slideDown, slideDownSlow, slideDownFast
const VALID_EFFECTS = new Set([
  "zoomIn", "zoomInSlow", "zoomInFast",
  "zoomOut", "zoomOutSlow", "zoomOutFast",
  "slideLeft", "slideLeftSlow", "slideLeftFast",
  "slideRight", "slideRightSlow", "slideRightFast",
  "slideUp", "slideUpSlow", "slideUpFast",
  "slideDown", "slideDownSlow", "slideDownFast",
]);

function mapCameraMotionToEffect(motion?: string): string | undefined {
  const map: Record<string, string> = {
    slow_zoom_in:  "zoomInSlow",
    slow_zoom_out: "zoomOutSlow",
    pan_left:      "slideLeftSlow",
    pan_right:     "slideRightSlow",
    drift_up:      "slideUpSlow",
    ken_burns:     "zoomInSlow",
    static:        "",
  };

  const mapped = map[motion ?? "static"] ?? "";

  // If Claude returned a raw Shotstack value directly, use it if valid
  if (motion && VALID_EFFECTS.has(motion)) return motion;

  // Return mapped value only if it's a valid Shotstack effect
  if (mapped && VALID_EFFECTS.has(mapped)) return mapped;

  // No effect (static) — return undefined so the key is omitted entirely
  return undefined;
}

function mapTransition(t: TransitionType): string {
  const map: Record<string, string> = {
    cut:        "none",
    fade_black: "fade",
    fade_white: "flash",
    dissolve:   "fade",
    slide_left: "carouselLeft",
  };
  return map[t] ?? "fade";
}
