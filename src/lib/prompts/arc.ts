import { ARCHETYPES } from '../archetypes'
import { filterLore } from '../lore'
import type { Archetype } from '../types'

export const LLM_SCENE_COUNT = 5

const ARC_ARCHETYPES: Archetype[] = ['cofounder', 'reporter', 'vc', 'hater', 'mentor']

export interface PriorChoiceSummary {
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildArcPromptInput {
  startupName: string
  startupDescription: string
  founderPersona: string
  stage?: string
  flavorTags: string[]
  priorChoices: PriorChoiceSummary[]
  currentStats: { hype: number; integrity: number }
  seed?: string
  todayISO: string
}

const SYSTEM_RULES = `You are the arc-skeleton engine for "Road to SF", a satirical comic-book founder game. The player has just finished 5 hand-authored onboarding scenes (Jordan calling from SF, the airport, the cofounder Maya). You produce the 5-scene LLM tail that closes the story.

HARD RULES:
- Output a single JSON object. No prose, no fences. The user message will start your response with "{".
- Real people are NEVER named — archetype them ("a Thiel-coded VC", "a YC partner with the blog", "a Sam-coded accelerator partner").
- Each scene has ONE archetype as the speaker. Use the assigned archetype list verbatim — do not reorder or substitute.
- Tone: comic, biting, cinematic. Each beat lands like a graphic novel panel.

OUTPUT SHAPE:
{
  "premise": string,                              // 1-2 sentences, the through-line
  "scenes": [                                     // exactly 5 entries
    {
      "index": 0..4,
      "archetype": "vc"|"cofounder"|"reporter"|"hater"|"mentor",
      "beat": string (≤220 chars, one sentence describing what happens),
      "hingesOn": string (optional, names the prior choice this scene exploits)
    }
  ]
}

The scenes you outline must:
- Pay off specific prior choices the player made (cite them in "hingesOn").
- Build to a final beat that lets the ending classifier (hype + integrity) land cleanly.
- Stay in archetype scope — do not invent new characters beyond the assigned 5.`

function formatPriorChoices(choices: PriorChoiceSummary[]): string {
  if (choices.length === 0) return '(no choices captured yet)'
  return choices
    .map(
      (c) =>
        `Scene ${c.sceneId}: chose "${c.choiceLabel}" (hype ${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}, integrity ${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta})`,
    )
    .join('\n')
}

function formatLoreBundle(input: BuildArcPromptInput): string {
  const lines: string[] = []
  lines.push('## CHARACTER ROSTER')
  ARC_ARCHETYPES.forEach((a) => {
    const def = ARCHETYPES[a]
    lines.push(`- ${a}: ${def.name}, ${def.title}. ${def.personality}`)
  })

  lines.push('\n## SF FLAVOR (use sparingly)')
  const seenPlaces = new Set<string>()
  const seenJokes = new Set<string>()
  const seenZ = new Set<string>()
  ARC_ARCHETYPES.forEach((a) => {
    const lore = filterLore({
      flavorTags: input.flavorTags,
      sceneArchetype: a,
      todayISO: input.todayISO,
      seed: input.seed,
      maxPlaces: 2,
      maxJokes: 1,
      maxZeitgeist: 1,
    })
    lore.places.forEach((p) => {
      if (seenPlaces.has(p.id)) return
      seenPlaces.add(p.id)
      lines.push(`- Place: ${p.name} — ${p.vibe}`)
    })
    lore.jokes.forEach((j) => {
      if (seenJokes.has(j.id)) return
      seenJokes.add(j.id)
      lines.push(`- Joke (${j.tone}): ${j.beat}`)
    })
    lore.zeitgeist.forEach((z) => {
      if (seenZ.has(z.id)) return
      seenZ.add(z.id)
      lines.push(`- Zeitgeist (${z.tone}): ${z.beat}`)
    })
  })

  lines.push(`\nAssigned archetype-per-scene order: ${ARC_ARCHETYPES.join(', ')}`)
  return lines.join('\n')
}

export function buildArcPromptParts(input: BuildArcPromptInput) {
  const userPlayerBlock = `## PLAYER STATE
Startup: ${input.startupName}
Pitch: ${input.startupDescription || '(unstated)'}
Founder vibe: ${input.founderPersona || '(unstated)'}
Stage: ${input.stage || '(unstated)'}
Flavor tags: ${input.flavorTags.length ? input.flavorTags.join(', ') : '(none)'}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

## PRIOR CHOICES (authored scenes 1-5)
${formatPriorChoices(input.priorChoices)}

## TASK
Produce a 5-scene arc that pays off these choices and lands an ending.`

  return {
    systemBlocks: [
      { text: SYSTEM_RULES, cache: false },
      { text: formatLoreBundle(input), cache: true }, // cached across the run
    ],
    userBlocks: [{ text: userPlayerBlock, cache: false }],
  }
}
