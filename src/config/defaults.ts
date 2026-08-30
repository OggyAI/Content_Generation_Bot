import dotenv from "dotenv";
dotenv.config();

const num  = (key: string, fallback: number)  => parseFloat(process.env[key] ?? String(fallback));
const str  = (key: string, fallback: string)  => process.env[key] ?? fallback;
const bool = (key: string, fallback: boolean) => {
  const v = process.env[key];
  return v !== undefined ? v === "true" : fallback;
};

export const config = {
  // Models
  anthropicModel:     str("ANTHROPIC_MODEL",      "claude-opus-4-6"),
  elevenLabsVoiceId:  str("ELEVENLABS_VOICE_ID",   ""),
  // Flash/Turbo = 0.5 credit/char — half the cost of multilingual_v2 (Master Brief Part 9)
  elevenLabsModelId:  str("ELEVENLABS_MODEL_ID",   "eleven_flash_v2_5"),
  elevenLabsSpeed:    num("ELEVENLABS_SPEED",       1.0),   // 1.0 normal; ~1.1 reads faster/tighter
  runwayModel:        str("RUNWAY_MODEL",           "gen3a_turbo"),
  stabilityModel:     str("STABILITY_MODEL",        "stable-diffusion-xl-1024-v1-0"),
  shotstackEnv:       str("SHOTSTACK_ENV",          "stage"),

  // ─── Image generation backbone (Master Brief Part 8 / Part 9) ──────────────
  // replicate  = fully automated REST API (default; backgrounds + reference-conditioned chars)
  // higgsfield = manifest mode: pipeline emits generation_manifest.json for interactive MCP fulfilment
  imageBackbone:      str("IMAGE_BACKBONE",          "replicate") as "replicate" | "higgsfield",
  // Reference-conditioned model on Replicate for on-model character scenes
  nanoBananaModel:    str("NANO_BANANA_MODEL",       "google/nano-banana"),
  // Channel STYLE-reference image (local path or URL). When set, sheets AND scenes are
  // generated with Nano Banana conditioned on this image, locking the flat hand-drawn look.
  styleReferenceImage: str("STYLE_REFERENCE_IMAGE",   ""),
  variantsPerScene:   num("VARIANTS_PER_SCENE",      2),    // candidates generated per scene for QA-and-select
  visualQa:           bool("VISUAL_QA",              true), // vision LLM scores + picks best variant, retries failures
  visualQaMinScore:   num("VISUAL_QA_MIN_SCORE",     6),    // below this → one auto-retry
  renderFps:          num("RENDER_FPS",              30),   // 30 default; 60 = smoother Ken-Burns, slower render
  renderPollMinutes:  num("RENDER_POLL_MINUTES",     40),   // how long to wait for a Shotstack render before timing out

  // ─── Per-video character design (auto cast + reference sheets, all on Replicate) ──
  autoCharacterDesign:  bool("AUTO_CHARACTER_DESIGN",   true), // design a fresh cast per video from the script
  maxDetailedCharacters: num("MAX_DETAILED_CHARACTERS", 2),    // hero/antagonist/love-interest cap per video
  characterDirection:   str("CHARACTER_DIRECTION",      ""),   // optional one-line art direction biasing the whole cast
  // Webcomic style: the POV lead is a DETAILED relatable character with his own reference
  // sheet (like the side characters). Set false to revert to the blank faceless figure.
  protagonistDetailed:  bool("PROTAGONIST_DETAILED",    true),

  // ─── Comic overlays & render polish (webcomic style) ────────────────────────
  bubblesEnabled:       bool("BUBBLES_ENABLED",         true),  // quoted dialogue → comic speech bubbles
  labelsEnabled:        bool("LABELS_ENABLED",          true),  // "23" / name labels on first appearance
  subtitlesEnabled:     bool("SUBTITLES_ENABLED",       true),  // burned-in bottom captions (SRT is exported regardless)
  renderGrade:          str("RENDER_GRADE",             "none") as "none" | "auto", // Shotstack per-scene colour filter

  // ─── Diegetic sound effects (ElevenLabs Sound Effects, layered under narration) ──
  sfxEnabled:           bool("SFX_ENABLED",            true),  // generate scene-matched SFX at key beats
  sfxVolume:            num("SFX_VOLUME",               0.35), // mix level under narration (0–1)

  // Pipeline controls
  productionMode:     str("PRODUCTION_MODE",        "low-cost") as "low-cost" | "premium",
  maxScenes:          num("MAX_SCENES",              18),
  minScenes:          num("MIN_SCENES",              8),
  targetRuntimeMin:   num("TARGET_RUNTIME_MIN",      9),
  targetRuntimeMax:   num("TARGET_RUNTIME_MAX",      12),
  budgetUsd:          num("BUDGET_USD",              15.0),
  retryLimit:         num("RETRY_LIMIT",             3),
  retryDelayMs:       num("RETRY_DELAY_MS",          2000),

  // Storage
  storagePath:        str("STORAGE_PATH",            "./output"),
  s3Bucket:           str("S3_BUCKET",               ""),
  s3BaseUrl:          str("S3_BASE_URL",             ""),
  s3Endpoint:         str("S3_ENDPOINT",             ""),

  // Approval
  approvalMode:       str("APPROVAL_MODE",           "file") as "file" | "server",

  // Narration pacing
  wordsPerMinute:     num("WORDS_PER_MINUTE",        145),
  minSceneDurationSec: num("MIN_SCENE_DURATION_SEC", 2.5),
  maxSceneDurationSec: num("MAX_SCENE_DURATION_SEC", 10),
  audioBatchChars:    num("AUDIO_BATCH_CHARS",       2400),  // max chars per with-timestamps request
  useWhisperX:        bool("USE_WHISPERX",           false), // optional forced-alignment fallback

  // API keys
  anthropicApiKey:    str("ANTHROPIC_API_KEY",       ""),
  elevenLabsApiKey:   str("ELEVENLABS_API_KEY",      ""),
  runwayApiKey:       str("RUNWAY_API_KEY",           ""),
  shotstackApiKey:    str("SHOTSTACK_API_KEY",        ""),
  stabilityApiKey:    str("STABILITY_API_KEY",        ""),
  replicateApiToken:  str("REPLICATE_API_TOKEN",      ""),
  s3AccessKey:        str("S3_ACCESS_KEY",            ""),
  s3SecretKey:        str("S3_SECRET_KEY",            ""),
  s3Region:           str("S3_REGION",               "us-east-1"),
};

export type Config = typeof config;
