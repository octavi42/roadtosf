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
}

// One row of the upfront arc-skeleton call: gives each LLM scene a beat,
// archetype, and short consequence note so per-scene calls stay coherent.
export interface SceneOutline {
  index: number // 0-indexed within the LLM tail (0..LLM_SCENE_COUNT-1)
  archetype: Archetype
  beat: string // one-sentence summary of what happens
  hingesOn?: string // notes on which prior choice should shape this scene
}

export interface ArcSkeleton {
  premise: string // 1-2 sentences capturing the through-line
  scenes: SceneOutline[]
}

export interface StoryArc {
  startupName: string
  founderPersona: string
  stage?: string
  flavorTags: string[]
  arcSkeleton?: ArcSkeleton
  scenes: Scene[] // LLM-generated tail; filled in as each generate-scene call returns
  endingKey?: EndingKey
  endingNarrative?: string
  shareCardPrompt?: string
  stats: {
    firedCofounder: boolean
    tookVCMoney: boolean
    leakedToPress: boolean
    playedSafeDemoDay: boolean
  }
}

export interface GenerateImageResult {
  b64Json: string
  format: 'jpeg' | 'png' | 'webp'
}
