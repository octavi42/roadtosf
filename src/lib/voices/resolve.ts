import library from './library.json'

export type Gender = 'male' | 'female' | 'neutral'
export type Age = 'young' | 'middle' | 'old'

export interface VoiceSpec {
  gender: Gender
  age: Age
  descriptives?: string[]
}

interface LibraryVoice {
  voice_id: string
  name: string
  gender: 'male' | 'female'
  age: Age
  accent?: string
  descriptives: string[]
}

const VOICES: LibraryVoice[] = (library as { voices: LibraryVoice[] }).voices

const GENDER_MATCH = 100
const AGE_MATCH = 50
const ADJACENT_AGE_MATCH = 20
const DESCRIPTIVE_MATCH = 8

const AGE_DISTANCE: Record<Age, Record<Age, number>> = {
  young: { young: 0, middle: 1, old: 2 },
  middle: { young: 1, middle: 0, old: 1 },
  old: { young: 2, middle: 1, old: 0 },
}

function score(spec: VoiceSpec, voice: LibraryVoice): number {
  let s = 0

  if (spec.gender === voice.gender) s += GENDER_MATCH
  else if (spec.gender === 'neutral') s += GENDER_MATCH / 2

  const dist = AGE_DISTANCE[spec.age][voice.age]
  if (dist === 0) s += AGE_MATCH
  else if (dist === 1) s += ADJACENT_AGE_MATCH

  if (spec.descriptives?.length) {
    const wanted = new Set(spec.descriptives.map((d) => d.toLowerCase()))
    for (const d of voice.descriptives) {
      if (wanted.has(d.toLowerCase())) s += DESCRIPTIVE_MATCH
    }
  }

  return s
}

export function resolveVoiceId(spec: VoiceSpec, exclude: string[] = []): string {
  const excluded = new Set(exclude)
  const candidates = VOICES.filter((v) => !excluded.has(v.voice_id))
  const pool = candidates.length > 0 ? candidates : VOICES

  let best: LibraryVoice = pool[0]
  let bestScore = score(spec, pool[0])
  for (let i = 1; i < pool.length; i++) {
    const s = score(spec, pool[i])
    if (s > bestScore) {
      best = pool[i]
      bestScore = s
    }
  }
  return best.voice_id
}

export function getLibraryVoice(voiceId: string): LibraryVoice | undefined {
  return VOICES.find((v) => v.voice_id === voiceId)
}
