# Content Generation Bot — Architecture & Workflow Spec

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATION LAYER                          │
│                                                                     │
│  CLI (src/cli.ts)  ──or──  HTTP Server  ──or──  n8n Workflow        │
│       │                     (src/server)          (webhook)         │
│       └─────────────────────────┬───────────────────────────────────┘
│                                 │
│                    ┌────────────▼────────────┐
│                    │   Pipeline Orchestrator  │
│                    │   (src/pipeline/index)   │
│                    └────────────┬────────────┘
│                                 │
│  ┌──────────────────────────────┼──────────────────────────────────┐
│  │                    PIPELINE STAGES                               │
│  │                                                                  │
│  │  01-classify ──▶ 02-brief ──▶ 03-outline ──▶ 04-script          │
│  │       │              │             │              │               │
│  │       │         [GATE 1: Brief + Outline]         │               │
│  │       │                                    [GATE 2: Script]      │
│  │       │                                           │               │
│  │  05-scenes ──▶ 06-visuals ──▶ 07-voiceover ──▶ 08-timeline      │
│  │       │              │                                            │
│  │       │         [GATE 3: First 5 Scenes]                         │
│  │       │                                                           │
│  │  09-render ──▶ 10-qa ──▶ 11-export                               │
│  │                    │         │                                    │
│  │             [GATE 4: Final]  └──▶ VideoPackage                   │
│  └──────────────────────────────────────────────────────────────────┘
│                                 │
│  ┌──────────────────────────────┼──────────────────────────────────┐
│  │                    API MODULES                                   │
│  │                                                                  │
│  │  Claude API    Stability AI    ElevenLabs    Runway    Shotstack │
│  │  (scripting)   (images)        (voice)       (video)   (render)  │
│  └──────────────────────────────────────────────────────────────────┘
│                                 │
│  ┌──────────────────────────────┼──────────────────────────────────┐
│  │                    SUPPORT LAYER                                  │
│  │                                                                  │
│  │  Job Store    Cache    Retry    Logger    Style Lock    Cost Ctrl │
│  └──────────────────────────────────────────────────────────────────┘
│                                 │
│  ┌──────────────────────────────▼──────────────────────────────────┐
│  │                    OUTPUT (per job)                               │
│  │                                                                  │
│  │  output/jobs/<job_id>/                                           │
│  │    ├── state.json          (full pipeline state)                 │
│  │    ├── assets/             (scene images + video clips)          │
│  │    ├── audio/              (voice chunks .mp3)                   │
│  │    ├── draft_render.mp4    (assembled video)                     │
│  │    ├── subtitles.srt       (SRT subtitle file)                  │
│  │    ├── youtube_meta.json   (titles, description, tags)           │
│  │    ├── description.txt     (copy-paste YouTube desc)             │
│  │    ├── chapters.txt        (YouTube chapter timestamps)          │
│  │    └── gate_*.json         (approval gate files)                 │
│  └──────────────────────────────────────────────────────────────────┘
```

## 2. Tech Stack Decisions

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Language** | TypeScript (Node.js 20+) | Type safety for complex data schemas, good async support, runs everywhere |
| **Scripting AI** | Claude API (Opus 4.6) | Best long-form writing quality, reliable JSON mode, handles all text generation stages |
| **Image Generation** | Stability AI (SDXL) | Low cost ($0.04/image), reliable, good style control. Fallback: Replicate |
| **Video Generation** | Runway Gen-3 Alpha | Premium mode only. Image-to-video for dramatic scenes. Expensive ($0.50/5s) |
| **Voice** | ElevenLabs | Best quality TTS, multilingual, consistent voice across scenes |
| **Video Assembly** | Shotstack | JSON-based API render, handles transitions/effects/subtitles, no local FFmpeg needed |
| **Orchestration** | Node.js pipeline + optional n8n | Pipeline runs as TypeScript. n8n wraps it for visual workflow / webhook triggers |
| **Storage** | Local filesystem | MVP simplicity. Optional S3/R2 upgrade for Shotstack asset access |
| **Approval** | File-based polling | Zero-dependency. Server mode for HTTP approvals. n8n mode for webhook gates |

### Upgrade Path
| Current | Future |
|---------|--------|
| Shotstack | Remotion (custom React-based rendering, full programmatic control) |
| Stability SDXL | Flux, Midjourney API, or fine-tuned models for channel style |
| File approval | n8n webhook + Slack/Discord notification |
| Local storage | Cloudflare R2 + CDN |
| Single machine | n8n cloud + serverless functions |

## 3. Folder Structure

```
content-generation-bot/
├── .env.example                # Environment variable template
├── .gitignore
├── package.json
├── tsconfig.json
├── ARCHITECTURE.md             # This file
│
├── src/
│   ├── cli.ts                  # CLI entry point
│   │
│   ├── config/
│   │   ├── defaults.ts         # Centralised config from env vars
│   │   ├── cost.ts             # Cost rate constants and estimator
│   │   └── style-lock.ts       # Channel visual style enforcement
│   │
│   ├── modules/                # API wrapper clients
│   │   ├── claude/client.ts    # Claude API (text + JSON modes)
│   │   ├── elevenlabs/client.ts# ElevenLabs TTS
│   │   ├── stability/client.ts # Stability AI image gen
│   │   ├── runway/client.ts    # Runway video gen (premium)
│   │   └── shotstack/client.ts # Shotstack video assembly + render
│   │
│   ├── pipeline/               # Ordered pipeline stages
│   │   ├── index.ts            # Main orchestrator (chains stages + gates)
│   │   ├── 01-classify.ts      # Topic → pillar + format mode
│   │   ├── 02-brief.ts         # Classification → research brief
│   │   ├── 03-outline.ts       # Brief → story structure outline
│   │   ├── 04-script.ts        # Outline → full narration script
│   │   ├── 05-scenes.ts        # Script → scene card array
│   │   ├── 06-visuals.ts       # Scene cards → image/video prompts → assets
│   │   ├── 07-voiceover.ts     # Scene narration → audio chunks
│   │   ├── 08-timeline.ts      # Scenes + audio → render timeline
│   │   ├── 09-render.ts        # Timeline → Shotstack render → MP4
│   │   ├── 10-qa.ts            # Automated QA checks
│   │   └── 11-export.ts        # Publishing package (SRT, meta, chapters)
│   │
│   ├── prompts/                # Claude prompt templates
│   │   ├── classify.ts
│   │   ├── brief.ts
│   │   ├── outline.ts
│   │   ├── script.ts
│   │   ├── scenes.ts
│   │   ├── visuals.ts
│   │   └── export.ts
│   │
│   ├── server/
│   │   └── index.ts            # Express server for approvals + job API
│   │
│   ├── types/
│   │   └── index.ts            # All TypeScript interfaces & enums
│   │
│   └── utils/
│       ├── approval.ts         # File-based approval gate handler
│       ├── cache.ts            # Asset dedup cache
│       ├── job-store.ts        # Disk-based job persistence
│       ├── logger.ts           # Colourised console logger
│       └── retry.ts            # Retry with exponential backoff
│
├── n8n/
│   └── workflow.json           # Starter n8n workflow definition
│
├── samples/
│   └── topic-input.json        # Example pipeline input
│
└── output/                     # Generated output (gitignored)
    ├── cache/
    │   └── index.json
    └── jobs/
        └── <job-id>/
            ├── state.json
            ├── assets/
            ├── audio/
            └── ...
```

## 4. Data Flow — Detailed

### Stage-by-Stage Flow

```
INPUT: TopicInput { topic, target_length_min, production_mode, budget_usd }
  │
  ▼
01-CLASSIFY
  │ Claude prompt → JSON
  │ Output: Classification { pillar, format_mode, era, setting, confidence }
  │
  ▼
02-BRIEF
  │ Claude prompt → JSON
  │ Output: TopicBrief { key_facts, key_figures, opening_style, visual_palette, ... }
  │
  ▼
03-OUTLINE
  │ Claude prompt → JSON
  │ Output: Outline { sections: OutlineSection[] }
  │ Structure auto-selected: single_life_arc OR multi_rank_stage
  │
  ├──── GATE 1: Human reviews brief + outline ────
  │
  ▼
04-SCRIPT
  │ Claude prompt → raw text with [SCENE: label] markers
  │ Output: ScriptDraft { full_text, word_count, estimated_min }
  │
  ├──── GATE 2: Human reviews full script ────
  │
  ▼
05-SCENES
  │ Claude prompt → JSON array
  │ Splits script into SceneCard[] (8–18 scenes)
  │ Each scene: narration, subtitle, timing, camera, transition, sound notes
  │
  ▼
06-VISUALS
  │ Step 1: Claude generates visual_prompt per scene (batched)
  │ Step 2: Stability AI generates images (all scenes)
  │         OR Runway generates video clips (premium, priority ≤ 2)
  │ Style-lock applied: positive/negative tokens appended to every prompt
  │
  ├──── GATE 3: Human reviews first 5 scene assets ────
  │
  ▼
07-VOICEOVER
  │ ElevenLabs TTS per scene
  │ Output: VoiceChunk[] with actual audio durations
  │ Scene durations updated to match real audio length
  │
  ▼
08-TIMELINE
  │ Assembles RenderPlan: video track, audio track, subtitle track
  │ Cumulative timing from actual audio durations
  │ Builds AssetManifest
  │
  ▼
09-RENDER
  │ Converts RenderPlan → Shotstack edit JSON
  │ Submits render, polls for completion, downloads MP4
  │
  ▼
10-QA
  │ Automated checks: runtime, scene count, subtitles, duplicates,
  │ style consistency, voice timing, missing assets, budget
  │
  ├──── GATE 4: Human reviews final render ────
  │
  ▼
11-EXPORT
  │ Generates: SRT subtitles, YouTube titles, description, tags,
  │ thumbnail text suggestions, chapter timestamps
  │ Output: VideoPackage
  │
  ▼
OUTPUT: output/jobs/<id>/ with all deliverables
```

## 5. Content Pillar & Format Mode Logic

### Classification Decision Matrix

| Topic Pattern | Pillar | Format Mode |
|---------------|--------|-------------|
| "Battle of...", "Pompeii", "Titanic survivor" | history_disaster | single_life_arc |
| "Odysseus", "Thor", "Hades" | myth_legend | single_life_arc |
| "Medieval knight ranks", "CIA agent levels" | rank_hierarchy | multi_rank_stage |
| "Yakuza hierarchy", "Roman military ranks" | rank_hierarchy | multi_rank_stage |
| "Secret assassin guild", "Shadow organization" | fictional_power | single_life_arc |
| "Ninja clan progression" | fictional_power | multi_rank_stage |

### Story Structure Templates

**Single Life Arc** (6 beats):
1. Hook (0.5–1 min) — Drop into the most gripping moment
2. Entry (1–1.5 min) — Who are you? What is your world?
3. Daily Life (1.5–2 min) — Texture of ordinary life
4. Escalation (2–3 min) — Pressure builds, stakes revealed
5. Turning Point (1.5–2 min) — Everything changes
6. Ending (1–1.5 min) — Consequence, legacy, haunting image

**Multi-Rank/Stage** (variable beats):
1. Hook (0.5 min) — Flash to the peak
2. Entry (0.5–1 min) — The system, the stakes
3. Rank Stage x3–4 (~2.5 min each) — Progression through levels
4. Turning Point (1 min) — Peak rank or catastrophic failure
5. Ending (1 min) — Legacy, reflection

## 6. Style Consistency System

### How Style-Lock Works

Every visual prompt is built from three layers:

```
[scene-specific content] + [era tokens] + [pillar mood tokens] + [base style tokens]
```

**Base tokens** (always included):
- semi-realistic stick figure character
- detailed cinematic background
- dramatic rim lighting, shallow depth of field
- widescreen cinematic composition 16:9

**Era modifiers** (selected by classifier):
- ancient: aged stone, torch-lit, ochre palette
- medieval: castle walls, candlelit, forest mist
- modern: urban, neon accents, sharp shadows
- mythological: ethereal gold, divine radiance, god rays

**Pillar moods** (selected by classifier):
- history_disaster: tension, smoke, amber fire glow
- myth_legend: mythic grandeur, supernatural haze
- rank_hierarchy: power hierarchy, imposing architecture
- fictional_power: shadow/secrecy, noir lighting

**Negative prompt** (always excluded):
- photorealistic human face, anime, cartoon, 3D render, watercolor, text, watermark

## 7. QA Checks

| Check | Severity | Rule |
|-------|----------|------|
| Runtime | error | Script must be 75%–125% of target range |
| Scene count | error | Between MIN_SCENES and MAX_SCENES |
| Subtitle overflow | warning | No line > 50 characters |
| Duplicate prompts | warning | No two scenes share identical visual prompts |
| Duplicate scenes | error | No two scenes share identical narration |
| Style consistency | warning | All prompts must contain "semi-realistic stick figure" |
| Voice timing | warning | No chunk < 2s or > MAX_SCENE_DURATION |
| Missing assets | error | All scenes must have a generated asset |
| Budget | warning | Total cost must not exceed budget |
| Scene durations | warning | Each scene 18–75 seconds |

## 8. Approval Gates

| Gate | After Stage | What to Review |
|------|-------------|---------------|
| **Gate 1** | Outline | Topic brief accuracy, outline structure, pacing |
| **Gate 2** | Script | Narration quality, tone, word count, scene markers |
| **Gate 3** | Visuals | First 5 scene images — style consistency, quality |
| **Gate 4** | QA | Final rendered video, QA report, total cost |

### Approval Modes

**File mode** (default): Pipeline writes `gate_<id>.pending.json`, pauses, and polls for `gate_<id>.approved.json` or `gate_<id>.rejected.json`.

**Server mode**: POST to `/jobs/:id/gates/:gateId` with `{ status: "approved" }`.

**n8n mode**: n8n webhook receives gate notification, sends Slack/email, waits for human response, POSTs approval back.

## 9. Cost Control

### Per-Video Budget Model (Low-Cost Mode)

| Component | Est. Cost | Notes |
|-----------|-----------|-------|
| Claude API (all stages) | $1.50–3.00 | ~20K input + ~8K output tokens across stages |
| Stability AI (12 images) | $0.48 | $0.04/image |
| ElevenLabs (12 scenes) | $1.80 | ~6000 chars at $0.30/1K |
| Shotstack render (10 min) | $5.40 | $0.009/sec |
| **Total low-cost** | **~$9–11** | |

### Per-Video Budget Model (Premium Mode)

| Component | Est. Cost | Notes |
|-----------|-----------|-------|
| Claude API | $2.00–3.50 | Slightly more for visual prompt refinement |
| Stability AI (8 stills) | $0.32 | Fewer stills, more video |
| Runway (4 clips x 5s) | $2.00 | $0.50/clip for dramatic scenes |
| ElevenLabs | $1.80 | Same |
| Shotstack | $5.40 | Same |
| **Total premium** | **~$12–16** | |

### Cost Controls

- **Budget guard**: Pipeline warns at 90% of budget, can halt at 100%
- **MAX_SCENES**: Hard cap prevents runaway image generation
- **Asset caching**: SHA-256 hash dedup — regenerated prompts hit cache
- **Priority gating**: Only priority 1–2 scenes get Runway video in premium mode
- **Retry limits**: Max 3 retries per API call to prevent cost spirals

## 10. Rendering Strategy

### MVP Approach
- All scenes rendered as **still images with camera motion** (zoom, pan, Ken Burns)
- Shotstack applies effects server-side
- Subtitles rendered as HTML overlay
- Narration audio per scene on audio track
- Music placeholder (manual add for now)

### Upgrade Path
1. **Phase 2**: Replace Shotstack with **Remotion** for full programmatic React-based rendering. Enables custom animations, text effects, waveform visualisations.
2. **Phase 3**: Add **Runway video clips** for 3–5 key dramatic moments per video (premium mode).
3. **Phase 4**: Fine-tune a **custom SDXL LoRA** on the channel's stick-figure style for perfect consistency.
4. **Phase 5**: Add **background music generation** via Suno/Udio API integration.

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude returns invalid JSON | Pipeline halts | Strip markdown fences, retry 3x, validate with Zod (future) |
| Stability AI rate limit | Missing assets | Exponential backoff, batch with delays, fallback to Replicate |
| ElevenLabs voice inconsistency | Jarring audio | Lock voice_id + stability/similarity params, cache chunks |
| Shotstack render timeout | No output | 10-min polling, retry submission, save partial state for resume |
| Style drift across scenes | Inconsistent video | Style-lock system enforces base tokens in every prompt |
| Budget overrun | Cost surprise | Real-time cost tracking, 90% warning, hard stop configurable |
| Script too long/short | Bad pacing | QA check enforces 75%–125% of target, Claude prompt specifies word range |
| API key exhaustion | Service down | Per-provider fallback config (Stability → Replicate, etc.) |
| Approval gate timeout | Stuck pipeline | 1-hour timeout, file-based so pipeline can resume later |

## 12. MVP Implementation Plan

### Phase 1: Core Pipeline (Week 1–2)
- [x] Data schemas (types/index.ts)
- [x] Config system (defaults, cost, style-lock)
- [x] API clients (Claude, Stability, ElevenLabs, Shotstack, Runway)
- [x] Pipeline stages 01–11
- [x] Prompt templates
- [x] Utilities (retry, cache, job store, logger, approval)
- [x] Main orchestrator with approval gates
- [x] CLI runner
- [x] Approval server
- [ ] npm install + first end-to-end test run
- [ ] Tune prompts based on output quality

### Phase 2: Polish (Week 3)
- [ ] Add Zod validation to all Claude JSON responses
- [ ] Add Creatomate as Shotstack alternative
- [ ] Build simple web dashboard for approval gates
- [ ] Add Slack/Discord notifications for gates
- [ ] SRT timing refinement with actual audio probing (ffprobe)

### Phase 3: n8n Integration (Week 4)
- [ ] Import n8n workflow JSON
- [ ] Configure webhook triggers
- [ ] Add Airtable/Notion integration for topic queue
- [ ] Schedule automated runs

### Phase 4: Advanced Rendering (Week 5+)
- [ ] Migrate to Remotion for custom rendering
- [ ] Add Runway video clips for premium scenes
- [ ] Custom SDXL LoRA training for channel style
- [ ] Background music generation
- [ ] Thumbnail image generation
- [ ] Auto-upload to YouTube via API
