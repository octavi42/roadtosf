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
  consequence: string // short internal note for LLM continuity
}

export interface Scene {
  id: number // 1–5
  title: string
  imagePrompt: string     // prompt sent to gpt-image-2
  imageUrl?: string       // base64 data URL, filled after image gen
  dialogue: DialogueLine[]
  choices: Choice[]
  timeoutSeconds: number
  timeoutChoiceId: string // which choice ID fires on timeout
}

export interface StoryArc {
  startupName: string
  founderPersona: string
  scenes: Scene[]
  endingKey: EndingKey
  endingNarrative: string
  shareCardPrompt: string // image gen prompt for final hero art
  stats: {
    firedCofounder: boolean
    tookVCMoney: boolean
    leakedToPress: boolean
    playedSafeDemoDay: boolean
  }
}

// What the API route returns for a single image generation
export interface GenerateImageResult {
  b64Json: string    // raw base64, no data URL prefix
  format: 'jpeg' | 'png' | 'webp'
}
