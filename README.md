# Content Generation Bot

A semi-automated production pipeline that turns a single topic sentence into a finished, narrated, illustrated long-form video — writing the script, designing recurring characters, generating every illustration, producing the voiceover, and assembling the final cut — with human approval checkpoints at six points along the way.

Built as a solo project to produce second-person POV storytelling videos for a faceless YouTube channel.

> **Status: working prototype, not a product.** It runs locally from a terminal. It is not deployed, has no automated tests, and has been run 5 times end to end. Read [Honest limitations](#honest-limitations) before drawing conclusions, and [SECURITY.md](SECURITY.md) for a self-audit of its security posture.

---

## What it actually does

You give it a topic. It gives you back an MP4 plus a publishing package (title, description, tags, thumbnail prompt).

```bash
npm run run:pipeline -- "A Roman legionary at the Battle of Cannae"
```

Between those two points it makes several hundred paid API calls across six external services over roughly 45–90 minutes, pausing six times to wait for you to approve or reject what it has produced so far.

---

## The 14-stage pipeline

Stages run strictly in sequence. State is written to disk after every stage, so a crashed or cancelled run can be resumed rather than restarted.

| # | Stage | File | What it does |
|---|---|---|---|
| 1 | Classify | `01-classify.ts` | Categorises the topic and picks a narrative treatment |
| 2 | Brief | `02-brief.ts` | Expands the topic into a creative brief |
| 3 | Outline | `03-outline.ts` | Beat-by-beat story structure |
| — | **🚦 Gate 1** | | **Brief + Outline review** |
| 4 | Script | `04-script.ts` | Full second-person narration script |
| — | **🚦 Gate 2** | | **Full script review** |
| 5 | Cast design | `04b-characters.ts` | Derives the cast, then draws character reference sheets |
| — | **🚦 Gate 3** | | **Cast design review** (edit `cast.json` before sheets are drawn) |
| — | **🚦 Gate 4** | | **Character sheet review** |
| 6 | Scenes | `05-scenes.ts` | Segments the script into scenes with shot annotations |
| 7 | Visuals | `06-visuals.ts` | Generates an image per scene |
| 8 | Visual QA | `06b-visual-qa.ts` | Vision-model scoring of generated images |
| — | **🚦 Gate 5** | | **First 5 scene assets review** |
| 9 | Voiceover | `07-voiceover.ts` | TTS narration with character-level timestamps |
| 10 | Timeline | `08-timeline.ts` | Builds the edit timeline from real audio timings |
| 11 | Upload | `08b-upload.ts` | Pushes assets to object storage for the renderer |
| 12 | Render | `09-render.ts` | Cloud render to MP4 |
| 13 | QA | `10-qa.ts` | 10 automated checks on the finished draft |
| — | **🚦 Gate 6** | | **Final draft review** |
| 14 | Export | `11-export.ts` | Title, description, tags, thumbnail prompt |

### Approval gates

Six gates (`gate_brief_outline`, `gate_script`, `gate_cast_design`, `gate_characters`, `gate_visuals`, `gate_final`) block the pipeline until a human approves. They exist because every stage past them spends real money on irreversible work — the gates are a deliberate cost control, not a UX flourish.

Gates time out. A timed-out gate marks the job failed; `resume` recovers it.

---

## Integrated APIs

Six services are integrated and have been used in real runs:

| Service | Role |
|---|---|
| **Anthropic Claude** | Script, outline, scene annotation, character design, vision QA |
| **Replicate** | Image generation — Flux 1.1 Pro (text-to-image), Nano Banana (reference-conditioned) |
| **ElevenLabs** | Text-to-speech with character-level timestamps; sound effects |
| **Shotstack** | Cloud video assembly (JSON edit spec → MP4) |
| **Cloudflare R2** | S3-compatible asset hosting so the cloud renderer can fetch images and audio |
| **Stability AI** | Legacy image fallback, superseded by Replicate |

A **Runway** client also exists in `src/modules/runway/` but was never used in a real run. A **Higgsfield** provider exists in "manifest mode" — it writes a JSON worklist for manual fulfilment rather than calling an API, because Higgsfield only exposes an interactive OAuth flow that a batch process cannot authenticate against.

---

## Design decisions worth knowing

**Timing is derived from real audio, not estimated.** Early versions estimated scene duration from word count, then from MP3 file size ÷ bitrate. Both drifted, producing a slideshow that fell out of sync with the narration. The estimate was abandoned entirely in favour of ElevenLabs' with-timestamps endpoint, which returns start/end times for every character of the script. Duration guardrails are applied at *segmentation* time by merging short sentences and splitting long ones — not by clamping clip lengths at render, which would have reintroduced the drift. Each image is held until the *next* sentence begins, which closed the inter-sentence gaps: measured maximum gap between consecutive images went from 0.603s to 0.000s.

**Character consistency was a mechanism problem, not a prompt problem.** Flux 1.1 Pro cannot accept a reference image at all, so character sheets were being generated and then never consulted. The fix was routing character scenes to a reference-conditioned model that takes the sheet as image input, with identity descriptors deliberately removed from the text prompt. Image generation sits behind an `ImageProvider` interface so the vendor choice stays reversible.

**Resume infers its restart point from data, not from a status flag.** Trusting `state.stage` failed in practice — a crashed job was marked `failed`, `failed` matched no stage, and resume silently completed without doing anything. Recovery now checks which artefacts exist (`if (state.video_package) return Exported;` and so on). Assets are content-addressed by SHA-256 of their generation inputs, so a resume never re-pays for completed work; one real resume reused all 120 cached images at zero image cost. Remote render IDs are persisted before polling begins, so a local timeout on a long render re-polls the existing job instead of paying to render it twice.

---

## Running it

**Requirements:** Node.js ≥ 20. No build step is used in practice; everything runs through `ts-node`.

```bash
npm install
cp .env.example .env    # then fill in your own API keys
```

You need your own accounts and credentials for Anthropic, Replicate, ElevenLabs, Shotstack, Cloudflare R2 and (optionally) Stability AI. See `.env.example` for every variable and what it does.

You also need to supply your own style reference image at `assets/style/style-anchor.png`. None is included in this repository — see `assets/style/README.txt`.

```bash
npm run run:pipeline -- "Your topic here"     # start a run
npm run cli -- run "Topic" --length 12 --budget 20 --mode low_cost
npm run cli -- list                            # list jobs
npm run cli -- status <job_id>                 # inspect a job
npm run cli -- resume <job_id>                 # resume a failed/interrupted job
npm run cli -- approve <job_id> <gate_id>      # clear an approval gate
npm run cli -- reject  <job_id> <gate_id>
npm run type-check                             # tsc --noEmit
```

An optional local Express server (`npm run run:server`) exposes the same job listing and gate approval over HTTP. **It has no authentication of any kind** — see [SECURITY.md](SECURITY.md) before running it.

Job state and all generated media land in `output/` (gitignored).

---

## Honest limitations

Being direct about this, because the numbers are small and an inflated claim would collapse under one follow-up question.

- **Not deployed.** No server, container, scheduler or cloud environment. It runs on demand from a Windows command line. Uptime is not a meaningful metric here.
- **Zero automated tests.** No test framework is installed. `test-pacing.ts` and `test-characters.ts` are diagnostic harnesses that print tables for a human to read — they contain no assertions.
- **5 total runs.** All 5 rendered to MP4. Two ended in a `failed` state, including the most recent one (2026-07-12).
- **Single user, single process.** No concurrency, no queue, no multi-tenancy. One run at a time, deliberately serial.
- **No database.** State is JSON files on local disk.
- **`zod` is a declared dependency but is never imported.** There is no schema validation anywhere. LLM JSON is `JSON.parse`d in a try/catch and then defaulted field by field, which is error tolerance, not validation.
- **Retry backoff is linear** (`delay × attempt`), despite a code comment describing it as "exponential-ish". It is not exponential.
- **Cost per video increased over time**, from $4.88 to $34.09, as scene counts grew. No cost optimisation work was done.
- **n8n orchestration and YouTube auto-publishing** were designed and documented but never built. The `n8n/workflow.json` file is a stub.
- **Quality still depends on a human curation pass** that has not been automated.

### Run history

| Job | Date | Topic | Scenes | Runtime | Cost | Final state |
|---|---|---|---|---|---|---|
| `b7ad80b2` | 2026-04-11 | Roman legionary at Cannae | 18 | 9.0 min | $5.03 | exported |
| `a01edac2` | 2026-04-11 | Fall of Pompeii | 18 | 7.7 min | $4.88 | exported |
| `2041fbd3` | 2026-06-22 | Chernobyl reactor operator | 133 | 14.7 min | $22.80 | **failed** (gate timeout) |
| `f9001174` | 2026-06-27 | Boatman on the Styx | 120 | 16.6 min | $19.39 | qa_done |
| `36ad2aeb` | 2026-07-12 | Fox spirit | 200 | 15.5 min | $34.09 | **failed** |

Totals across all runs: **476 images**, **56 audio files**, **5 rendered videos**, **$86.19** tracked spend.

---

## Codebase

51 TypeScript files, 5,755 lines in `src/`.

```
src/pipeline/   14 stage implementations + orchestrator
src/modules/    one client per external service, behind small interfaces
src/prompts/    all LLM prompt construction, isolated from pipeline logic
src/utils/      state store, cache, retry, logging, approval gates, timing
src/config/     defaults, cost model, style lock, series config
src/types/      shared domain types
src/server/     optional local Express approval server (144 lines, unauthenticated)
```

---

## Licence

No licence file is present. All rights reserved by default — this is a personal project published for reference, not for reuse.
