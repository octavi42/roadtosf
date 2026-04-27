export type Archetype = 'vc' | 'cofounder' | 'reporter' | 'hater' | 'mentor'

export type EndingKey = 'ipo' | 'acquihire' | 'indicted' | 'ai-wrapper' | 'ghosted'

export interface DialogueLine {
  speaker: Archetype | 'player' | 'narrator'
  text: string
  audioUrl?: string // filled in after ElevenLabs call
}

export interface Choice {
  id: string
  label: string
  consequence?: string // short internal note for LLM continuity
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

export type GroupStatus = 'pending' | 'ready' | 'failed'

export interface Group {
  id: number // 1, 2, 3
  twistCard: string
  scenes: Scene[]
  status: GroupStatus
}

export interface StoryArc {
  startupName: string
  founderPersona: string
  flavorTags: string[]
  groups: Group[]
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
