/**
 * Deterministic sentence-level segmentation for audio-driven pacing.
 *
 * Granularity = one sentence ≈ one scene/image. Guardrails are applied AT
 * SEGMENTATION (not at render) so each image window can equal its audio span
 * exactly with no drift:
 *   - MIN: merge consecutive sentences until a segment is at least minSec long.
 *   - MAX: split a sentence longer than maxSec into a wide shot + detail/symbolic
 *          insert(s) at clause boundaries (each piece marked is_insert after the first).
 */

export interface Segment {
  text:             string;
  est_duration_sec: number;   // WPM estimate — replaced by real audio timing later
  is_insert:        boolean;  // 2nd+ image of a split long sentence
}

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "inc", "ltd",
  "co", "corp", "e.g", "i.e", "a.m", "p.m", "u.s", "u.k", "u.n", "no", "vol", "fig",
  "approx", "dept", "gen", "gov", "sgt", "lt", "col", "capt", "cmdr", "sen", "rep",
  "ave", "blvd", "rd", "ph.d", "b.c", "a.d",
]);

// Plain-ASCII sentinel marking a protected (non-boundary) period. Restored to "." at the end.
const DOT = "AABLDOTAABL";

/** Remove [SCENE: ...] markers and normalise whitespace. */
export function stripMarkers(script: string): string {
  return script.replace(/\[SCENE:[^\]]*\]/gi, " ").replace(/\s+/g, " ").trim();
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function estSec(s: string, wpm: number): number {
  return (wordCount(s) / wpm) * 60;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Split prose into sentences, handling abbreviations, decimals, ellipses and dialogue. */
export function splitSentences(text: string): string[] {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];

  // Protect decimals (3.14).
  t = t.replace(/(\d)\.(\d)/g, `$1${DOT}$2`);

  // Protect known abbreviations (Mr.  e.g.  U.S.).
  for (const ab of ABBREVIATIONS) {
    const re = new RegExp(`\\b(${ab.replace(/\./g, "\\.")})\\.`, "gi");
    t = t.replace(re, (m) => m.split(".").join(DOT));
  }

  // Protect single-letter initials (J. R. R.).
  t = t.replace(/\b([A-Z])\.(?=\s+[A-Z])/g, `$1${DOT}`);

  // Protect ellipses so we never split inside "...".
  t = t.replace(/\.\.\./g, `${DOT}${DOT}${DOT}`);

  // Boundary = terminal punctuation (+ optional closing quote) followed by
  // whitespace and the start of a new sentence (capital, quote, or digit).
  const parts: string[] = [];
  const re = /([.!?]+["'”’)\]]?)\s+(?=["'“([]?[A-Z0-9])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    parts.push(t.slice(last, m.index + m[1].length));
    last = re.lastIndex;
  }
  parts.push(t.slice(last));

  return parts
    .map(p => p.split(DOT).join(".").trim())
    .filter(Boolean);
}

/** Split one over-long sentence into ceil(est/maxSec) pieces at clause boundaries. */
function splitLong(text: string, wpm: number, maxSec: number): string[] {
  const pieceCount = Math.max(2, Math.ceil(estSec(text, wpm) / maxSec));
  const words = text.split(/\s+/);
  const per = Math.ceil(words.length / pieceCount);

  const pieces: string[] = [];
  let i = 0;
  for (let k = 0; k < pieceCount && i < words.length; k++) {
    let end = Math.min(i + per, words.length);
    // Nudge the cut to the nearest clause boundary within a small window.
    if (end < words.length) {
      const win = 3;
      for (let j = Math.min(words.length - 1, end + win); j >= Math.max(i + 1, end - win); j--) {
        if (/[,;:—–-]$/.test(words[j - 1])) { end = j; break; }
      }
    }
    pieces.push(words.slice(i, end).join(" "));
    i = end;
  }
  if (i < words.length) pieces[pieces.length - 1] += " " + words.slice(i).join(" ");
  return pieces.filter(Boolean);
}

export interface SegmentOpts { wordsPerMinute: number; minSec: number; maxSec: number; }

/** Full segmentation: split → merge-short(MIN) → split-long(MAX). */
export function segmentScript(script: string, opts: SegmentOpts): Segment[] {
  const { wordsPerMinute: wpm, minSec, maxSec } = opts;
  const sentences = splitSentences(stripMarkers(script));

  // 1) Merge consecutive sentences until each group is at least minSec.
  const merged: string[] = [];
  let cur = "";
  for (const s of sentences) {
    cur = cur ? `${cur} ${s}` : s;
    if (estSec(cur, wpm) >= minSec) { merged.push(cur); cur = ""; }
  }
  if (cur) {
    if (merged.length && estSec(cur, wpm) < minSec) merged[merged.length - 1] += ` ${cur}`;
    else merged.push(cur);
  }

  // 2) Split any group longer than maxSec into wide + insert(s).
  const segments: Segment[] = [];
  for (const group of merged) {
    if (estSec(group, wpm) <= maxSec) {
      segments.push({ text: group, est_duration_sec: round1(estSec(group, wpm)), is_insert: false });
    } else {
      splitLong(group, wpm, maxSec).forEach((p, idx) =>
        segments.push({ text: p, est_duration_sec: round1(estSec(p, wpm)), is_insert: idx > 0 })
      );
    }
  }
  return segments;
}
