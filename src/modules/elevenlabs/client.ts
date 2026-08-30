import axios from "axios";
import path from "path";
import fs from "fs-extra";
import { config } from "../../config/defaults";
import { withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";
import { getCached, setCached, hashKey } from "../../utils/cache";

const BASE_URL = "https://api.elevenlabs.io/v1";
// Flash/Turbo bill at 0.5 credit/char — half the standard rate (Master Brief Part 9).
const COST_PER_1K_CHARS = /flash|turbo/i.test(config.elevenLabsModelId) ? 0.15 : 0.30;

export interface TTSResult {
  audioPath: string;
  durationSec: number;
  costUsd: number;
  cached: boolean;
}

/** Character-level alignment returned by the with-timestamps endpoint. */
export interface Alignment {
  chars:  string[];
  starts: number[];   // seconds, per character
  ends:   number[];   // seconds, per character
}

function lastOf(arr: number[]): number | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

export interface TTSTimedResult extends TTSResult {
  alignment: Alignment;
}

/**
 * Generate voiceover AND character-level timestamps in one call.
 * Primary path for audio-driven pacing — maps each sentence to its exact audio span.
 */
export async function generateVoiceoverWithTimestamps(
  text: string,
  outputDir: string,
  filename: string,
  voiceId = config.elevenLabsVoiceId,
  stability = 0.50,
  similarityBoost = 0.75
): Promise<TTSTimedResult> {
  const cacheKey  = hashKey(`tts-ts:${voiceId}:${config.elevenLabsModelId}:${text}`);
  const cachedPath = await getCached(cacheKey);

  if (cachedPath) {
    const sidecar = `${cachedPath}.align.json`;
    if (await fs.pathExists(sidecar)) {
      const alignment = (await fs.readJson(sidecar)) as Alignment;
      const durationSec = lastOf(alignment.ends) ?? await getAudioDuration(cachedPath, text);
      return { audioPath: cachedPath, durationSec, costUsd: 0, cached: true, alignment };
    }
  }

  return withRetry(async () => {
    logger.step("elevenlabs", `Generating timed audio: ${filename}`);

    const voiceSettings: Record<string, number> = { stability, similarity_boost: similarityBoost };
    if (config.elevenLabsSpeed !== 1.0) voiceSettings.speed = config.elevenLabsSpeed;  // only send when changed

    const response = await axios.post(
      `${BASE_URL}/text-to-speech/${voiceId}/with-timestamps`,
      {
        text,
        model_id: config.elevenLabsModelId,
        voice_settings: voiceSettings,
      },
      {
        headers: {
          "xi-api-key": config.elevenLabsApiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    const data = response.data as {
      audio_base64: string;
      alignment?: {
        characters: string[];
        character_start_times_seconds: number[];
        character_end_times_seconds: number[];
      };
    };

    await fs.ensureDir(outputDir);
    const audioPath = path.join(outputDir, `${filename}.mp3`);
    await fs.writeFile(audioPath, Buffer.from(data.audio_base64, "base64"));

    const a = data.alignment;
    const alignment: Alignment = a
      ? { chars: a.characters, starts: a.character_start_times_seconds, ends: a.character_end_times_seconds }
      : { chars: [], starts: [], ends: [] };

    await fs.writeJson(`${audioPath}.align.json`, alignment);
    await setCached(cacheKey, audioPath);

    const durationSec = lastOf(alignment.ends) ?? await getAudioDuration(audioPath, text);
    const costUsd     = (text.length / 1000) * COST_PER_1K_CHARS;

    logger.success("elevenlabs", `Saved ${filename}.mp3 (${durationSec.toFixed(1)}s, ${alignment.chars.length} char timings) — $${costUsd.toFixed(4)}`);
    return { audioPath, durationSec, costUsd, cached: false, alignment };
  }, `ElevenLabs:ts:${filename}`);
}

export async function generateVoiceover(
  text: string,
  outputDir: string,
  filename: string,
  voiceId  = config.elevenLabsVoiceId,
  stability  = 0.50,
  similarityBoost = 0.75
): Promise<TTSResult> {
  const cacheKey = hashKey(`tts:${voiceId}:${text}`);
  const cached   = await getCached(cacheKey);

  if (cached) {
    const durationSec = await getAudioDuration(cached, text);
    return { audioPath: cached, durationSec, costUsd: 0, cached: true };
  }

  return withRetry(async () => {
    logger.step("elevenlabs", `Generating audio: ${filename}`);

    const response = await axios.post(
      `${BASE_URL}/text-to-speech/${voiceId}`,
      {
        text,
        model_id: config.elevenLabsModelId,
        voice_settings: { stability, similarity_boost: similarityBoost },
      },
      {
        headers: {
          "xi-api-key": config.elevenLabsApiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        responseType: "arraybuffer",
      }
    );

    await fs.ensureDir(outputDir);
    const audioPath = path.join(outputDir, `${filename}.mp3`);
    await fs.writeFile(audioPath, Buffer.from(response.data));

    await setCached(cacheKey, audioPath);

    const durationSec = await getAudioDuration(audioPath, text);
    const costUsd     = (text.length / 1000) * COST_PER_1K_CHARS;

    logger.success("elevenlabs", `Saved ${filename}.mp3 (~${durationSec.toFixed(1)}s) — $${costUsd.toFixed(4)}`);
    return { audioPath, durationSec, costUsd, cached: false };
  }, `ElevenLabs:${filename}`);
}

/**
 * Get actual audio duration from the MP3 file.
 * Falls back to word-count estimate if probing fails.
 */
async function getAudioDuration(filePath: string, text: string): Promise<number> {
  try {
    // Read MP3 file and calculate duration from file size and bitrate
    const stat = await fs.stat(filePath);
    const fileSizeBytes = stat.size;
    // ElevenLabs outputs 128kbps MP3 by default
    const bitrate = 128 * 1000; // bits per second
    const durationSec = (fileSizeBytes * 8) / bitrate;
    return Math.round(durationSec * 10) / 10;
  } catch {
    // Fallback to word count estimate
    const wordCount = text.trim().split(/\s+/).length;
    const seconds = (wordCount / config.wordsPerMinute) * 60;
    return Math.round(seconds * 10) / 10;
  }
}

export interface SFXResult { audioPath: string; durationSec: number; costUsd: number; cached: boolean; }

/**
 * Generate a diegetic sound effect from a text prompt (ElevenLabs Sound Effects API).
 * Used for scene-matched ambient/impact sounds layered under the narration.
 */
export async function generateSoundEffect(
  prompt: string,
  durationSec: number,
  outputDir: string,
  filename: string
): Promise<SFXResult> {
  const dur = Math.round(Math.min(Math.max(durationSec, 1), 12) * 10) / 10;  // ElevenLabs SFX: 0.5–22s
  const cacheKey = hashKey(`sfx:${prompt}:${dur}`);
  const cached   = await getCached(cacheKey);
  if (cached) return { audioPath: cached, durationSec: dur, costUsd: 0, cached: true };

  return withRetry(async () => {
    logger.step("elevenlabs", `SFX: "${prompt.slice(0, 40)}" (${dur}s)`);

    const response = await axios.post(
      `${BASE_URL}/sound-generation`,
      { text: prompt, duration_seconds: dur, prompt_influence: 0.4 },
      {
        headers: {
          "xi-api-key": config.elevenLabsApiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        responseType: "arraybuffer",
      }
    );

    await fs.ensureDir(outputDir);
    const audioPath = path.join(outputDir, `${filename}.mp3`);
    await fs.writeFile(audioPath, Buffer.from(response.data));
    await setCached(cacheKey, audioPath);

    const costUsd = 0.02;  // nominal — ElevenLabs SFX bills against plan credits
    logger.success("elevenlabs", `Saved SFX ${filename}.mp3 (${dur}s)`);
    return { audioPath, durationSec: dur, costUsd, cached: false };
  }, `ElevenLabs:sfx:${filename}`);
}

/** List available voices */
export async function listVoices(): Promise<Array<{ voice_id: string; name: string }>> {
  const response = await axios.get(`${BASE_URL}/voices`, {
    headers: { "xi-api-key": config.elevenLabsApiKey },
  });
  return response.data.voices;
}
