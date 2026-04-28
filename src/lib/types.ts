import type { RolledCameo, ToneId } from './cameos/types'
import type { StoryletKind, StoryletState } from './storylets/types'

export type Archetype = 'vc' | 'cofounder' | 'reporter' | 'hater' | 'mentor'

export type EndingKey = 'ipo' | 'acquihire' | 'indicted' | 'ai-wrapper' | 'ghosted'

export interface DialogueLine {
  speaker: Archetype | 'player' | 'narrator'
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

export interface Scene {
  id: number
  title: string
  archetype: Archetype
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

// One row of an episode skeleton: gives each LLM scene a beat, archetype, and
// short note on which prior choice should shape it.
export interface SceneOutline {
  index: number // 0-indexed within the *current episode* (0..EPISODE_LENGTH-1)
  archetype: Archetype
  beat: string
  // Sonnet sometimes emits explicit null. Readers must short-circuit on falsy.
  hingesOn?: string | null
  /** Optional: when the storylet behind this scene is a "solo" or
   *  "world-event" kind, the scene renders as narrator-led (no NPC of
   *  this archetype actually speaks). Defaults to "encounter" when
   *  missing — preserves old skeleton behavior. */
  kind?: StoryletKind
  /** Short scenario summary (~140 chars max) — the SKELETON for sub
   *  1-3 of this group. Sub 0 uses the verbose `beat`; sub 1-3 use
   *  this summary as the only anchor so they generate on-the-fly per
   *  choice but stay within the same conversation. Set server-side
   *  by /api/generate-arc from the chosen storylet's `summary` field. */
  summary?: string | null
}

// One episode = one /api/generate-arc call. Episodes are regenerated as the
// player plays past the end of the current skeleton.
export interface ArcSkeleton {
  episodeIndex: number // 0 for the first skeleton, 1 for the second, ...
  premise: string
  scenes: SceneOutline[]
  storySoFar?: string // returned with episodes 1+; compresses everything before
}

export interface StoryArc {
  startupName: string
  founderPersona: string
  stage?: string
  flavorTags: string[]
  arcSkeleton?: ArcSkeleton // current episode's skeleton (replaced on regen)
  scenes: Scene[] // unbounded list of LLM-generated scenes
  storySoFar?: string // rolling compressed summary; updated each episode regen
  endingKey?: EndingKey
  endingNarrative?: string
  shareCardPrompt?: string
  stats: {
    firedCofounder: boolean
    tookVCMoney: boolean
    leakedToPress: boolean
    playedSafeDemoDay: boolean
  }
  // Per-run "fate" — rolled once at run-start, stable across episodes.
  // Drives both the arc/scene prompts and the rarity reveal on the
  // ending screen.
  rolledCameos?: RolledCameo[]
  tone?: ToneId
  // Storylet engine state — fired list + flags. Carried across episodes
  // so cooldowns and cross-episode flag gates work. Updated server-side
  // by /api/generate-arc and persisted on each arcSkeletonReady.
  storyletState?: StoryletState
}

export interface GenerateImageResult {
  b64Json: string
  format: 'jpeg' | 'png' | 'webp'
}
