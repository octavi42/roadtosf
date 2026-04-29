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

/** A Scene is a CONTAINER the player stays inside through many beats.
 *  Image + setting + cast + nameplate are pre-fixed at episode-gen
 *  time. Dialogue ACCUMULATES across beats as the player makes
 *  choices; choices REPLACE on each beat. */
export interface Scene {
  id: number
  /** Pre-fixed at episode-gen time. */
  title: string
  /** Primary role of the scene (image + voice routing). Pre-fixed. */
  role: Role
  /** @deprecated mirror of `role`; kept for back-compat readers. */
  archetype?: Role
  /** Pre-fixed concrete time + place for THIS scene. */
  setting?: string | null
  /** Cast subset for THIS scene (from the episode's full roster). */
  cast?: CastMember[]
  /** Pre-fixed image prompt. Image-gen fires once per scene from this. */
  imagePrompt: string
  imageUrl?: string
  /** Accumulating dialogue. Beat 1's lines, then beat 2's, then beat
   *  3's — all in one array as the player makes choices and beats
   *  flow. */
  dialogue: DialogueLine[]
  /** ONLY the LATEST beat's choices. Replaced (not appended) when a
   *  new beat arrives. */
  choices: Choice[]
  /** From the latest beat. */
  timeoutSeconds: number
  timeoutChoiceId: string
  /** Indices into `dialogue` where each beat starts. beatStarts[0]=0;
   *  beatStarts[k] = index where beat k's first line lives. Used by
   *  the player progress to know which lines are "new" after a choice. */
  beatStarts?: number[]
  /** Set true once a beat with isLastBeatOfScene lands. UI uses this to
   *  decide whether the next choice click should advance to the next
   *  scene rather than fire another beat. */
  sceneClosed?: boolean
  /** Set true when the latest beat marked the episode's last scene's
   *  last beat. Triggers next-episode-gen on choice click. */
  isLastSceneOfEpisode?: boolean | null
  // Optional: when present, the UI surfaces a "Share Moment" overlay at
  // the start of the latest beat. Frequency is capped client-side
  // (1 per episode).
  shareMoment?: ShareMoment
}

/** One scene's pre-fixed plan in the episode skeleton. */
export interface ScenePlan {
  /** 0-indexed within the episode. */
  index: number
  /** Primary role for image + voice routing. */
  role: Role
  /** Concrete time + place. Stays stable for ALL beats of this scene. */
  setting: string
  /** Cast subset (from episode roster) appearing in this scene. */
  cast: CastMember[]
  /** Short topic / what this scene is about — the through-line for
   *  the beats Haiku will generate inside this scene. */
  topic: string
  /** Pre-fixed image prompt — same image used across all beats of
   *  this scene. */
  imagePrompt: string
  /** Pre-fixed nameplate / scene title. */
  title: string
}

/** A single Beat = one dialogue exchange + one choice block. Returned
 *  by /api/generate-scene per call. Beats accumulate inside a Scene
 *  container until the LLM marks isLastBeatOfScene.
 *
 *  Pivot overrides (setting/cast/role/title) are emitted on beat 0 of
 *  scenes after scene 0 when the prior scene's outcome made the planned
 *  scene incoherent. Most beats leave them undefined and the client
 *  uses the plan's values. */
export interface Beat {
  dialogue: DialogueLine[]
  choices: Choice[]
  timeoutSeconds: number
  timeoutChoiceId: string
  /** True when this beat closes the scene's arc. The next choice click
   *  should advance to the next scene plan, not fire another beat. */
  isLastBeatOfScene: boolean
  /** True when this is the LAST scene's last beat — triggers next
   *  episode-gen. */
  isLastSceneOfEpisode?: boolean | null
  shareMoment?: ShareMoment
  /** Pivot override — re-defines this scene's setting. */
  setting?: string | null
  /** Pivot override — re-defines this scene's cast subset. */
  cast?: CastMember[] | null
  /** Pivot override — re-defines this scene's primary role. */
  role?: Role | null
  /** Pivot override — re-defines this scene's nameplate title. */
  title?: string | null
}

// ── EPISODE ARCHITECTURE ─────────────────────────────────────────────
// Episode-gen pre-plans 3-5 scenes (setting, cast, imagePrompt, topic
// per scene). Images for all scenes are generated in parallel when
// the episode plan lands. As the player plays, scene-gen fires per
// choice, returning ONE BEAT (dialogue + choices) at a time. Beats
// accumulate inside a Scene container; the player stays in the same
// scene (same image, same setting) across multiple beats until the
// LLM marks the beat as the scene's last.

/** One episode = one /api/generate-episode call. */
export interface Episode {
  episodeIndex: number
  theme: string
  premise: string
  /** Full speaker roster for the episode. Each ScenePlan picks a
   *  subset for that scene's cast. */
  cast: CastMember[]
  /** 3–5 pre-planned scene plans. Setting / cast subset / imagePrompt
   *  / topic are committed at episode-gen time. */
  scenes: ScenePlan[]
  storySoFar?: string | null
  /** Ids of storylet seeds the planner drew on; persisted via
   *  StoryArc.firedSeedIds for cross-episode cooldown. */
  seedIds: string[]
  /** Client-side: global llmIndex at which this episode's scene 0
   *  lives in arc.scenes. */
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
