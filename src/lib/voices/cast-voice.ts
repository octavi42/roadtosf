import type { CastMember } from '@/lib/types'
import type { ParsedEpisodePlan } from '@/lib/schemas/episode'
import { resolveVoiceId, type Gender, type Age } from './resolve'

const NARRATOR_RESERVED = '6SMKBar4Q5wkVHdFlcQC'
const PLAYER_RESERVED = 'nqvoG2qlLhOhieQPdowv'

function specFor(member: CastMember) {
  return {
    gender: (member.gender ?? 'neutral') as Gender,
    age: (member.age ?? 'middle') as Age,
    descriptives: member.descriptives,
  }
}

/**
 * Assign a unique ElevenLabs voiceId to every cast member at episode
 * level, then mirror those ids onto each scene's cast subset by name.
 *
 * Dedup is intra-episode only — once a voice is taken by Maya in
 * scene 1, it's excluded for the rest of the episode's roster. The
 * narrator and player voices are reserved up-front so a cast member
 * can never collide with them.
 */
export function assignVoicesToEpisode(plan: ParsedEpisodePlan): ParsedEpisodePlan {
  const exclude = new Set<string>([NARRATOR_RESERVED, PLAYER_RESERVED])
  const voiceByName = new Map<string, string>()

  const cast = plan.cast.map((member) => {
    const existing = voiceByName.get(member.name)
    if (existing) return { ...member, voiceId: existing }
    const voiceId = resolveVoiceId(specFor(member), Array.from(exclude))
    exclude.add(voiceId)
    voiceByName.set(member.name, voiceId)
    return { ...member, voiceId }
  })

  const rosterByName = new Map(cast.map((c) => [c.name, c]))

  const scenes = plan.scenes.map((scene) => ({
    ...scene,
    cast: scene.cast.map((member) => {
      const canonical = rosterByName.get(member.name)
      if (canonical) {
        // Episode roster wins for identity fields — the episode cast
        // is the source of truth, scene cast subsets mirror it.
        return {
          ...member,
          voiceId: canonical.voiceId,
          gender: canonical.gender,
          age: canonical.age,
          descriptives: canonical.descriptives,
        }
      }
      // Scene introduces a name not in the episode roster — rare;
      // resolve a fresh voice and add to dedup set so later scenes
      // don't collide.
      const voiceId = resolveVoiceId(specFor(member), Array.from(exclude))
      exclude.add(voiceId)
      voiceByName.set(member.name, voiceId)
      return { ...member, voiceId }
    }),
  }))

  return { ...plan, cast, scenes }
}
