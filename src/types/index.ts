// ─── ENUMS ────────────────────────────────────────────────────────────────────

export enum ContentPillar {
  HistoryDisaster = "history_disaster",
  MythLegend      = "myth_legend",
  RankHierarchy   = "rank_hierarchy",
  FictionalPower  = "fictional_power",
}

export enum FormatMode {
  SingleLifeArc  = "single_life_arc",
  MultiRankStage = "multi_rank_stage",
}

export enum ProductionMode {
  LowCost = "low-cost",
  Premium = "premium",
}

export enum ApprovalStatus {
  Pending  = "pending",
  Approved = "approved",
  Rejected = "rejected",
  Skipped  = "skipped",
}

export enum AssetType {
  Still         = "still",
  MotionClip    = "motion_clip",
  GeneratedClip = "generated_clip",
  Placeholder   = "placeholder",
}

export enum TransitionType {
  Cut       = "cut",
  FadeBlack = "fade_black",
  FadeWhite = "fade_white",
  Dissolve  = "dissolve",
  SlideLeft = "slide_left",
}

export enum CameraMotion {
  Static       = "static",
  SlowZoomIn   = "slow_zoom_in",
  SlowZoomOut  = "slow_zoom_out",
  PanLeft      = "pan_left",
  PanRight     = "pan_right",
  KenBurns     = "ken_burns",
  DriftUp      = "drift_up",
}

// Shot grammar — vary every scene (Master Brief Part 3.3)
export enum ShotType {
  Establishing   = "establishing",    // wide, atmosphere, carries location
  TwoShot        = "two_shot",         // protagonist + another character
  CloseUp        = "close_up",         // faces / emotional beats
  DetailInsert   = "detail_insert",    // hands, objects
  SymbolicInsert = "symbolic_insert",  // figurative line rendered literally
}

// Two-tier character system (Master Brief Part 3.1)
export enum CharacterRole {
  Protagonist = "protagonist",   // blank POV lead — text spec only, sprite-consistent
  Detailed    = "detailed",      // hero / love interest / antagonist — reference sheet
  Crowd       = "crowd",         // blank silhouettes, near-zero cost
}

// Palette / mood lane — lock ONE per series (Master Brief Part 3.2)
export enum SeriesLane {
  WarmCinematic   = "warm_cinematic",    // Ref A — warm-to-cold emotional shifts
  DesaturatedGrim = "desaturated_grim",  // Ref B — uniformly grim monochrome
}

export enum EndingMode {
  EngagementCTA = "engagement_cta",  // disclaimer + moral question + subscribe (recommended)
  PoeticLoop    = "poetic_loop",     // cyclical callback, no CTA
}

export interface CharacterSpec {
  id:                   string;
  name:                 string;
  role:                 CharacterRole;
  blueprint_prompt:     string;          // reusable, replicable text description
  reference_sheet_url?: string;          // canonical sheet image (local path or URL) for reference-conditioned gen
  palette_hex?:         string[];
}

export interface SeriesConfig {
  series_id:     string;
  lane:          SeriesLane;
  palette_grade: string;          // human-readable grade description
  style_anchor:  string;          // one-paragraph background style anchor, prepended to every BG prompt
  ending_mode:   EndingMode;
  protagonist:   CharacterSpec;   // the blank POV lead (channel constant)
  characters:    CharacterSpec[]; // the detailed characters (regenerated PER VIDEO when auto-design is on)
  crowd_style?:  string;          // channel-constant generic look for background crowds (reused across videos)
}

export enum PipelineStage {
  Ingested   = "ingested",
  Classified = "classified",
  Briefed    = "briefed",
  Outlined   = "outlined",
  Scripted   = "scripted",
  CastDesigned = "cast_designed",               // cast blueprints proposed (editable) — before sheets draw
  CharactersDesigned = "characters_designed",   // reference sheets generated from the (edited) cast
  Scened     = "scened",
  Visualised = "visualised",
  VisualSelected = "visual_selected",   // visual QA-and-select pass complete
  Voiced     = "voiced",
  Timed      = "timed",
  Rendered   = "rendered",
  QADone     = "qa_done",
  Exported   = "exported",
  Failed     = "failed",
}

// ─── APPROVAL GATE ────────────────────────────────────────────────────────────

export interface ApprovalGate {
  gate_id:    string;
  label:      string;
  stage:      PipelineStage;
  status:     ApprovalStatus;
  notes?:     string;           // reviewer notes
  timestamp?: string;
}

// ─── INPUTS ───────────────────────────────────────────────────────────────────

export interface TopicInput {
  topic:            string;           // e.g. "A Roman Legionary in the Battle of Cannae"
  title_hint?:      string;           // optional YouTube title draft
  content_notes?:   string;           // any specific angle or focus
  target_length_min: number;          // desired video length in minutes
  production_mode:  ProductionMode;
  budget_usd?:      number;
}

// ─── CLASSIFICATION ───────────────────────────────────────────────────────────

export interface Classification {
  pillar:        ContentPillar;
  format_mode:   FormatMode;
  era?:          string;              // "216 BC", "Viking Age", etc.
  setting?:      string;              // "Ancient Rome", "Norse Mythology"
  tone_guidance: string;              // brief tone note from classifier
  confidence:    number;              // 0–1
  reasoning:     string;
}

// ─── RESEARCH & BRIEF ─────────────────────────────────────────────────────────

export interface ResearchNote {
  note_id:   string;
  topic:     string;
  content:   string;
  source?:   string;               // "Claude synthesis" or URL
  verified:  boolean;
}

export interface TopicBrief {
  brief_id:       string;
  topic:          string;
  pillar:         ContentPillar;
  format_mode:    FormatMode;
  era:            string;
  setting:        string;
  key_facts:      string[];
  key_figures:    string[];
  tone_notes:     string;
  opening_style:  string;          // "POV: You are..." | "This is what..." | "It's the year..."
  world_context:  string;          // 1–2 paragraph world-building context
  visual_palette: string;          // mood/colour/lighting guidance
  research_notes: ResearchNote[];
  created_at:     string;
}

// ─── OUTLINE ──────────────────────────────────────────────────────────────────

export interface OutlineSection {
  section_id:    string;
  index:         number;
  label:         string;           // "Hook", "Entry Into the World", etc.
  beat_type:     OutlineBeatType;
  summary:       string;
  stage_label?:  string;           // For multi-rank: "Rank 1: Novice", etc.
  estimated_min: number;           // estimated time in minutes
  key_moments:   string[];
}

export enum OutlineBeatType {
  Hook         = "hook",
  Entry        = "entry",
  DailyLife    = "daily_life",
  Escalation   = "escalation",
  TurningPoint = "turning_point",
  Ending       = "ending",
  RankStage    = "rank_stage",    // multi-rank mode only
}

export interface Outline {
  outline_id:    string;
  topic:         string;
  format_mode:   FormatMode;
  total_est_min: number;
  sections:      OutlineSection[];
  created_at:    string;
}

// ─── SCRIPT ───────────────────────────────────────────────────────────────────

export interface ScriptDraft {
  script_id:     string;
  topic:         string;
  full_text:     string;           // raw narration text with [SCENE: label] markers
  word_count:    number;
  estimated_min: number;
  version:       number;
  created_at:    string;
}

// ─── SCENE CARD ───────────────────────────────────────────────────────────────

export interface SceneCard {
  scene_id:            string;
  scene_index:         number;
  outline_section_ref: string;           // OutlineSection.section_id
  start_time_estimate: number;           // seconds from video start
  duration_estimate:   number;           // seconds
  narration_text:      string;
  subtitle_text:       string;           // cleaned, shortened for display

  // ─── Audio-driven timing (sentence-level pacing) ─────────────────────────────
  // Assigned from real ElevenLabs timestamps in the voiceover stage; the image's
  // on-screen window equals exactly [start_sec, end_sec] so it tracks the words.
  start_sec?:          number;           // global start in the final audio
  end_sec?:            number;           // global end in the final audio
  duration_sec?:       number;           // end_sec − start_sec
  is_insert?:          boolean;          // true = the 2nd image of a split long sentence (detail/symbolic)

  // ─── Shot grammar & staging (Master Brief Part 9 — scene JSON) ───────────────
  shot_type:           ShotType;         // establishing | two_shot | close_up | detail_insert | symbolic_insert
  location:            string;           // where this beat happens
  mood:                string;           // emotional/colour mood for grading (e.g. "intimacy", "loss", "nightlife")
  character_refs:      string[];         // CharacterSpec.id list present in this scene ([] = background only)
  character_prompt:    string;           // detailed-character instruction for this scene ("" if none)
  placement_note:      string;           // where/how characters sit in frame, scale, facing
  is_symbolic_insert:  boolean;          // figurative narration rendered literally

  // ─── Generation ──────────────────────────────────────────────────────────────
  background_prompt?:  string;           // background-plate prompt (visuals stage)
  visual_prompt:       string;           // full image/video generation prompt
  style_tags:          string[];         // locked channel style tokens
  negative_prompt:     string;           // things to exclude from image gen
  variant_urls?:       string[];         // candidate images generated for QA-and-select
  qa_score?:           number;           // 0–10 from visual QA stage
  qa_notes?:           string;           // issues flagged by visual QA

  // ─── Diegetic sound effects (selective, key beats only) ──────────────────────
  sfx_prompt?:         string;           // sound-effect cue for this beat ("" / undefined = none)
  sfx_url?:            string;           // generated SFX audio (local path, then R2 URL)

  // ─── Comic overlays (webcomic style — speech bubbles + name/age labels) ───────
  dialogue_text?:      string;           // quoted speech in this beat → rendered as a comic bubble
  dialogue_side?:      "left" | "right"; // which side of frame the speaker sits (approximate)
  overlay_labels?:     Array<{ text: string; side: "left" | "right" }>; // e.g. "23", "Jack" on first appearance

  camera_motion:       CameraMotion;
  transition_type:     TransitionType;
  sound_design_notes:  string;
  asset_type:          AssetType;
  asset_url?:          string;           // filled after generation (selected best variant)
  priority:            number;           // 1 (high) to 5 (low)
  approval_status:     ApprovalStatus;
  generation_cost?:    number;           // USD
}

// ─── VOICE CHUNK ──────────────────────────────────────────────────────────────

export interface VoiceChunk {
  chunk_id:        string;
  scene_id:        string;
  scene_index:     number;
  text:            string;
  audio_url?:      string;             // local path or CDN URL
  duration_sec?:   number;
  start_offset_sec?: number;           // global start of this batch in the final audio (sentence-pacing batches)
  voice_id:        string;
  model_id:        string;
  stability?:      number;             // ElevenLabs stability (0–1)
  similarity?:     number;             // ElevenLabs similarity_boost (0–1)
  generated_at?:   string;
  cost_usd?:       number;
}

// ─── ASSET MANIFEST ───────────────────────────────────────────────────────────

export interface AssetManifest {
  manifest_id:   string;
  job_id:        string;
  scenes:        SceneAsset[];
  music_track?:  string;             // path or URL
  created_at:    string;
}

export interface SceneAsset {
  scene_id:    string;
  asset_type:  AssetType;
  asset_url:   string;
  width:       number;
  height:      number;
  duration?:   number;              // for video assets
  cached:      boolean;
}

// ─── RENDER PLAN ──────────────────────────────────────────────────────────────

export interface RenderPlan {
  render_plan_id:  string;
  job_id:          string;
  total_duration:  number;           // seconds
  tracks:          RenderTrack[];
  output_format:   "mp4" | "webm";
  resolution:      "hd" | "fhd";    // 1280x720 | 1920x1080
  fps:             number;
  created_at:      string;
}

export interface RenderTrack {
  track_type: "video" | "audio_narration" | "audio_music" | "audio_sfx" | "subtitle"
            | "overlay_bubble" | "overlay_label";   // comic overlays (separate tracks — clips in one track cannot overlap)
  clips:      RenderClip[];
}

export interface RenderClip {
  clip_id:         string;
  scene_id?:       string;
  asset_url:       string;
  start:           number;           // seconds
  length:          number;           // seconds
  effect?:         string;           // "zoomIn" | "zoomOut" | "slideLeft" etc.
  filter?:         string;           // Shotstack colour-grade filter (mood/lane grade)
  transition?:     TransitionType;
  subtitle_text?:  string;
  html_kind?:      "subtitle" | "bubble" | "label";  // which overlay renderer to use
  offset_x?:       number;           // horizontal offset (-1..1) for bubble/label placement
  offset_y?:       number;           // vertical offset (-1..1)
  font_size?:      number;
  opacity?:        number;
}

// ─── QA REPORT ────────────────────────────────────────────────────────────────

export interface QACheck {
  check_id:   string;
  label:      string;
  passed:     boolean;
  severity:   "error" | "warning" | "info";
  detail:     string;
}

export interface QAReport {
  report_id:   string;
  job_id:      string;
  passed:      boolean;
  checks:      QACheck[];
  created_at:  string;
}

// ─── VIDEO PACKAGE (final export) ─────────────────────────────────────────────

export interface VideoPackage {
  package_id:          string;
  job_id:              string;
  mp4_path:            string;
  srt_path:            string;
  thumbnail_prompts:   string[];
  title_options:       string[];
  description:         string;
  chapter_timestamps:  ChapterTimestamp[];
  tags:                string[];
  created_at:          string;
}

export interface ChapterTimestamp {
  label:   string;
  time_sec: number;
  display: string;    // "0:00", "1:32", etc.
}

// ─── JOB STATE ────────────────────────────────────────────────────────────────

export interface JobState {
  job_id:          string;
  topic_input:     TopicInput;
  series?:         SeriesConfig;        // per-job series: channel style + this video's generated cast
  cast_proposed?:  boolean;             // cast blueprints written to cast.json (editable, pre-sheet)
  cast_ready?:     boolean;             // reference sheets generated from the (edited) cast
  classification?: Classification;
  brief?:          TopicBrief;
  outline?:        Outline;
  script?:         ScriptDraft;
  scenes?:         SceneCard[];
  voice_chunks?:   VoiceChunk[];
  asset_manifest?: AssetManifest;
  render_plan?:    RenderPlan;
  render_id?:      string;            // Shotstack render id — persisted so a poll timeout can re-poll, not re-render
  render_url?:     string;
  qa_report?:      QAReport;
  video_package?:  VideoPackage;
  stage:           PipelineStage;
  approval_gates:  ApprovalGate[];
  cost_usd:        number;
  errors:          PipelineError[];
  created_at:      string;
  updated_at:      string;
}

export interface PipelineError {
  stage:     PipelineStage;
  message:   string;
  retries:   number;
  timestamp: string;
}
