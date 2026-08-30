/**
 * Optional whisperX forced-alignment fallback (Master Brief: "otherwise add a whisperX
 * forced-alignment fallback on the rendered MP3"). OFF by default (USE_WHISPERX=false).
 *
 * This is a best-effort shell-out to the `whisperx` CLI — it is NOT installed by this
 * project. Enable only if you have Python + `pip install whisperx` available on PATH.
 * It is used solely when the ElevenLabs with-timestamps endpoint returns no alignment.
 */
import path from "path";
import os from "os";
import fs from "fs-extra";
import { execFile } from "child_process";
import { promisify } from "util";
import { Alignment } from "../elevenlabs/client";
import { logger } from "../../utils/logger";

const execFileAsync = promisify(execFile);

interface WhisperXWord { word: string; start: number; end: number }

/**
 * Run whisperX on an audio file and return a character-level Alignment built from its
 * word timings. Throws if whisperx is unavailable or produces no output — callers should
 * catch and fall back to proportional timing.
 */
export async function alignWithWhisperX(audioPath: string): Promise<Alignment> {
  const outDir = path.join(os.tmpdir(), `whisperx_${Date.now()}`);
  await fs.ensureDir(outDir);

  logger.step("whisperx", `Forced-aligning ${path.basename(audioPath)} (fallback)`);
  await execFileAsync("whisperx", [
    audioPath,
    "--output_dir", outDir,
    "--output_format", "json",
    "--language", "en",
  ], { timeout: 600_000 });

  const jsonFile = (await fs.readdir(outDir)).find(f => f.endsWith(".json"));
  if (!jsonFile) throw new Error("whisperx produced no JSON output");

  const data = await fs.readJson(path.join(outDir, jsonFile));
  const words: WhisperXWord[] =
    data.word_segments ??
    (data.segments ?? []).flatMap((s: { words?: WhisperXWord[] }) => s.words ?? []);

  if (words.length === 0) throw new Error("whisperx returned no word timings");

  // Build a char-level alignment by distributing each word's span across its characters.
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  words.forEach((w, wi) => {
    const text = w.word ?? "";
    const span = Math.max(0, w.end - w.start);
    const per  = text.length > 0 ? span / text.length : 0;
    for (let i = 0; i < text.length; i++) {
      chars.push(text[i]);
      starts.push(w.start + i * per);
      ends.push(w.start + (i + 1) * per);
    }
    if (wi < words.length - 1) {           // inter-word space
      chars.push(" ");
      starts.push(w.end);
      ends.push(w.end);
    }
  });

  await fs.remove(outDir).catch(() => {});
  return { chars, starts, ends };
}
