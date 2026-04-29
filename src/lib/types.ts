import type { RolledCameo, ToneId } from './cameos/types'
import type { StoryletKind, StoryletState } from './storylets/types'

// Role keys — the kind of character. The 5 core roles are kept as
// stable string keys for image / voice / cameo wiring. Display labels
// ("the partner", "the cofounder candidate", etc.) live in archetypes.ts.
// Names are now LLM-assigned per scene from cameo + persona context.
export type Role = 'vc' | 'cofounder' | 'reporter' | 'hater' | 'mentor'
/** @deprecated use Role */
export type Archetype = Role

export type EndingKey = 'ipo' | 'acquihire' | 'indicted' | 'ai-wrapper' | 'ghosted'

export interface DialogueLine {
  speaker: Role | 'player' | 'narrator'
  text: string
  audioUrl?: string
}

export interface Choice {
  id: string
  label: string
  consequence?: string
  hype: number
  integrity: number
}

export interface ShareMoment {
  title: string
  blurb: string
}

export interface CastMember {
  role: Role
  /** Per-scene LLM-assigned name. May be a real public figure (Peter
   *  Thiel, Sam Altman) when the cameo engine seeded one, OR a
   *  context-appropriate name the planner invented. */
  name: string
  blurb?: string
}

export interface Scene {
  id: number
  title: string
  /** Primary role for this scene's image / portrait. Multi-role scenes
   *  list all speakers in `cast` (mirrored from the parent ScenePlan).
   *  Kept as a single Role for the image pipeline. */
  role: Role
  /** @deprecated mirror of `role`; kept for back-compat readers. */
  archetype?: Role
  /** Mirrored from the parent ScenePlan so dialogue rendering can map
   *  speaker → display name without a lookup back to the Episode. */
  cast?: CastMember[]
  imagePrompt: string
  imageUrl?: string
  dialogue: DialogueLine[]
  choices: Choice[]
  timeoutSeconds: number
  timeoutChoiceId: string
  // Optional: when present, the UI surfaces a "Share Moment" overlay at the
  // start of this scene. Frequency is capped client-side (1 per episode).
  shareMoment?: ShareMoment
}

// ── EPISODE ARCHITECTURE ─────────────────────────────────────────────
// Episodes are the new unit of LLM-generated content. One Sonnet call
// per episode produces a coherent theme (location/event/cast) and a
// 3–5 scene plan with pre-fixed setting + cast + imagePrompt for each
// scene. Haiku (scene-gen) only writes dialogue + choices, reading
// the pre-fixed scene context.

/** One scene's pre-fixed context inside an episode plan. Setting,
 *  cast, and image prompt are committed at episode-gen time so
 *  scene-gen has no freedom to invent a new location or new
 *  characters mid-episode. */
export interface ScenePlan {
  /** 0-indexed within the episode. */
  index: number
  /** Primary role for image + voice routing. */
  role: Role
  /** Concrete location ("the Y Combinator co-working space", "Peter
   *  Thiel's office at Founders Fund"). */
  setting: string
  /** Everyone who could plausibly speak in this scene. Multi-role
   *  scenes are explicitly allowed: a hackathon scene might list
   *  cofounder + competitor + mentor. */
  cast: CastMember[]
  /** What happens. The single sentence that anchors Haiku's render. */
  beat: string
  /** Optional storylet kind: encounter (default), solo, world-event.
   *  Sonnet emits explicit null for omitted optionals — accept it. */
  kind?: StoryletKind | null
  /** Pre-baked image prompt. The scene route emits this as the
   *  imagePrompt SSE event the moment Haiku starts streaming, so
   *  image-gen begins ~5s earlier than waiting on Haiku's output. */
  imagePrompt: string
}

/** One episode = one /api/generate-episode call. */
export interface Episode {
  episodeIndex: number
  /** One coherent theme: "hackathon weekend", "demo day prep",
   *  "cofounder is leaving", etc. Spliced into scene prompts so each
   *  scene knows what episode it lives in. */
  theme: string
  /** 1–2 sentence premise the planner committed to before laying out
   *  scenes. Drives the through-line. */
  premise: string
  /** 3–5 ScenePlans, in order. */
  scenes: ScenePlan[]
  storySoFar?: string | null
  /** Ids of storylet seeds the planner picked from. Persisted across
   *  episodes via StoryArc.firedSeedIds for cross-episode cooldown. */
  seedIds: string[]
  /** Client-side: the global llmIndex at which this episode's scene 0
   *  lives in arc.scenes. Set in episodePlanReady (= arc.scenes.length
   *  at the moment the plan landed). Used to compute sceneIndexInEpisode
   *  for any global llmIndex. */
  startLLMIndex?: number
}

export interface StoryArc {
  startupName: string
  founderPersona: string
  stage?: string
  flavorTags: string[]
  /** Current episode (replaces ArcSkeleton). */
  currentEpisode?: Episode
  /** 0 for the first episode, 1 for the second, etc. Owned client-side
   *  so we know which episode to gen next when the player finishes the
   *  last scene of the current one. */
  episodeIndex: number
  scenes: Scene[] // unbounded list of LLM-generated scenes
  storySoFar?: string // rolling compressed summary; updated each episode
  endingKey?: EndingKey
  endingNarrative?: string
  shareCardPrompt?: string
  stats: {
    firedCofounder: boolean
    tookVCMoney: boolean
    leakedToPress: boolean
    playedSafeDemoDay: boolean
  }
  rolledCameos?: RolledCameo[]
  tone?: ToneId
  /** Cross-episode cooldown bookkeeping. Storylet seed ids the planner
   *  has already used. Excluded from the seed pool on the next episode
   *  to prevent the same beat firing twice in a single run. */
  firedSeedIds?: string[]
  /** Legacy storylet state. Kept on the type for in-flight runs that
   *  haven't been migrated; the new pipeline only reads firedSeedIds. */
  storyletState?: StoryletState
}

export interface GenerateImageResult {
  b64Json: string
  format: 'jpeg' | 'png' | 'webp'
}
