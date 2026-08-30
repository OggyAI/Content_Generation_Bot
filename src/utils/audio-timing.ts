/**
 * Map sentence segments onto real audio timestamps.
 *
 * The narration is generated in BATCHES (each under the model's char limit) via the
 * ElevenLabs with-timestamps endpoint. Within a batch, every sentence is located by
 * its character offset in the batch text and read off the character-level alignment.
 * Batches are then offset by the cumulative real audio duration of prior batches, so
 * the whole video shares one drift-free timeline.
 */
import { Alignment } from "../modules/elevenlabs/client";

export interface SentenceSpan { start: number; end: number; }

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Group item indices into batches that each stay under maxChars (never splits an item). */
export function buildCharBatches(texts: string[], maxChars: number): number[][] {
  const batches: number[][] = [];
  let cur: number[] = [];
  let curChars = 0;

  texts.forEach((t, i) => {
    const len = t.length + 1; // + joining space
    if (cur.length > 0 && curChars + len > maxChars) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(i);
    curChars += len;
  });
  if (cur.length) batches.push(cur);
  return batches;
}

/**
 * Map each sentence (in order) to its [start,end] within a batch.
 * `sentences` MUST be the exact trimmed strings joined by " " to form the batch text.
 */
export function mapSentenceSpans(
  sentences: string[],
  alignment: Alignment,
  batchDuration: number
): SentenceSpan[] {
  const batchText = sentences.join(" ");
  const aligned =
    alignment.chars.length > 0 &&
    alignment.starts.length === alignment.chars.length &&
    alignment.ends.length === alignment.chars.length &&
    alignment.chars.length === batchText.length;

  const spans: SentenceSpan[] = [];
  let cursor = 0;

  for (const s of sentences) {
    const startIdx = cursor;
    const endIdx   = cursor + s.length;   // exclusive
    cursor = endIdx + 1;                  // +1 for the joining space

    if (aligned) {
      const si = clamp(startIdx, 0, alignment.starts.length - 1);
      const ei = clamp(endIdx - 1, 0, alignment.ends.length - 1);
      spans.push({ start: alignment.starts[si], end: alignment.ends[ei] });
    } else {
      // Proportional fallback when alignment is unavailable or length-mismatched.
      const total = Math.max(1, batchText.length);
      spans.push({
        start: (startIdx / total) * batchDuration,
        end:   (Math.min(endIdx, total) / total) * batchDuration,
      });
    }
  }

  // Enforce monotonic, non-overlapping spans.
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start < spans[i - 1].end) spans[i].start = spans[i - 1].end;
    if (spans[i].end < spans[i].start)     spans[i].end   = spans[i].start;
  }
  return spans;
}
