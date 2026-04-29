import type { RolledCameo, ToneId } from './cameos/types'
import type { StoryletState } from './storylets/types'

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
  /** Primary role for this scene's image / portrait. */
  role: Role
  /** @deprecated mirror of `role`; kept for back-compat readers. */
  archetype?: Role
  /** Concrete setting Haiku invented for this scene ("the YC kitchen
   *  at 11pm Tuesday"). Drives both the dialogue framing and the
   *  imagePrompt. */
  setting?: string | null
  /** Subset of the episode's cast roster who actually appear in this
   *  scene. Picked by Haiku per-scene based on the prior choice. */
  cast?: CastMember[]
  /** Haiku-emitted: true on the scene that closes the episode arc.
   *  Triggers the next /api/generate-episode call client-side. */
  isLastSceneOfEpisode?: boolean | null
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
// Episodes are a LIGHTWEIGHT skeleton: theme + cast roster + a rough
// arc. Scenes are NOT pre-planned — Haiku invents setting + dialogue +
// choices + imagePrompt fresh for each scene at scene-gen time, reading
// the episode skeleton + the player's prior choice. The LLM signals
// when the episode arc closes via Scene.isLastSceneOfEpisode.

/** One episode = one /api/generate-episode call. Lightweight skeleton
 *  only — no per-scene plans. Scenes are generated on the fly. */
export interface Episode {
  episodeIndex: number
  /** Coherent theme spanning the whole episode: "hackathon weekend",
   *  "demo day prep", "cofounder is leaving". */
  theme: string
  /** 1–2 sentence through-line. */
  premise: string
  /** Full speaker roster for the episode — every named character who
   *  could plausibly appear in any scene. Scene-gen picks a subset
   *  based on the prior choice; it MUST NOT invent new named
   *  characters outside this list. */
  cast: CastMember[]
  /** 3–5 short bullet points of *possible* beats / arc directions
   *  the LLM may draw from. NOT scene-by-scene plans — these are
   *  loose hints. Scene-gen invents the actual concrete moments. */
  arcBullets: string[]
  storySoFar?: string | null
  /** Ids of storylet seeds the planner drew on. Persisted across
   *  episodes via StoryArc.firedSeedIds for cross-episode cooldown. */
  seedIds: string[]
  /** Client-side: the global llmIndex at which this episode's first
   *  scene lives in arc.scenes. Used to compute sceneIndexInEpisode
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
