import { ARCHETYPES } from '../archetypes'
import { filterLore } from '../lore'
import type { Archetype } from '../types'

export const EPISODE_LENGTH = 5

const ARC_ARCHETYPES: Archetype[] = ['cofounder', 'reporter', 'vc', 'hater', 'mentor']

export interface PriorChoiceSummary {
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildArcPromptInput {
  episodeIndex: number // 0 for the opening episode, 1+ for regenerations
  priorStorySoFar?: string // present on episodes 1+
  startupName: string
  startupDescription: string
  founderPersona: string
  stage?: string
  // Captured in scene 4 Q&A (or extracted from the pitch). The LLM MUST honor
  // these — never invent a contradicting cofounder name or funding situation.
  team?: string
  fundingModel?: string
  targetCustomer?: string
  concern?: string
  flavorTags: string[]
  // For episode 0: choices from authored scenes. For 1+: only the LAST EPISODE's
  // choices (everything older is compressed into priorStorySoFar).
  recentChoices: PriorChoiceSummary[]
  currentStats: { hype: number; integrity: number }
  seed?: string
  todayISO: string
}

const SYSTEM_RULES = `You are the arc-skeleton engine for "Road to SF", a satirical comic-book founder game running in ENDLESS MODE. The story is delivered as 5-scene episodes; you produce one episode at a time.

HARD RULES:
- Output a single JSON object only. No prose before or after, no markdown fences. Start your response with "{" and end with "}".
- Numbers must be valid JSON: write 1 not +1, write 2 not +2.
- Real people are NEVER named — archetype them ("a Thiel-coded VC", "a YC partner with the blog", "a Sam-coded accelerator partner").
- Each scene has ONE archetype as the speaker. Use the assigned archetype list verbatim — do not reorder or substitute.
- Tone: comic, biting, cinematic. Each beat lands like a graphic novel panel.
- The story does NOT end at the close of an episode — the player chooses when to end the run. Land each episode on a hook, not a resolution.
- Each "beat" string MUST be ≤ 400 characters. One sentence preferred. Do not pad with detail.

ABSOLUTE PROHIBITIONS (override anything else if they conflict):
- NEVER name a character "Maya" unless the player's "Team" facts explicitly contain "Maya".
- If the player's Team says "solo" / "no cofounder" / similar:
  • Do NOT introduce a cofounder character that already exists in the player's life.
  • The "cofounder" archetype scene must reframe — e.g. an old friend pitching to join, a YC-batch acquaintance trying to attach themselves, the ghost of a cofounder the player ALMOST had. Treat the player as alone.
- If the player's Funding says "bootstrapping" / "no raise" / similar:
  • Do NOT invent term sheets the player accepted, VC partnership offers under negotiation, or implied fundraising history.
  • VC scenes can still happen but as cold pitches the player is being SOLICITED for, not deals already in motion.
- If the player named a cofounder (e.g. "my cofounder Anna"), use that name verbatim. Never substitute "Maya" or anyone else.

OUTPUT SHAPE:
{
  "episodeIndex": <integer matching the input>,
  "premise": string (1-2 sentences, the through-line of THIS episode),
  "scenes": [                                     // exactly 5 entries
    {
      "index": 0..4,                              // index within this episode
      "archetype": "vc"|"cofounder"|"reporter"|"hater"|"mentor",
      "beat": string (≤220 chars, one sentence describing what happens),
      "hingesOn": string (optional, names the prior choice this scene exploits)
    }
  ],
  "storySoFar": string (REQUIRED for episodeIndex >= 1; 200 words max compressing
                        EVERYTHING that happened in prior episodes, in present-tense,
                        named-choice prose. Omit for episodeIndex 0.)
}

Constraints by episode:
- episodeIndex = 0: "recentChoices" comes from the player's authored onboarding scenes. No priorStorySoFar.
- episodeIndex >= 1: "recentChoices" is just the last 5 (most recent episode's). Use "priorStorySoFar" for everything older. Your "storySoFar" output must extend the prior summary with the last episode's events.`

function formatRecentChoices(choices: PriorChoiceSummary[]): string {
  if (choices.length === 0) return '(none)'
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
  const isOpening = input.episodeIndex === 0

  const userPlayerBlock = `## PLAYER STATE
Startup: ${input.startupName}
Pitch: ${input.startupDescription || '(unstated)'}
Founder vibe: ${input.founderPersona || '(unstated)'}
Stage: ${input.stage || '(unstated)'}
Flavor tags: ${input.flavorTags.length ? input.flavorTags.join(', ') : '(none)'}

## PLAYER FACTS (HONOR THESE — never invent contradictions)
Team: ${input.team || '(unstated; do not invent a cofounder, treat as solo)'}
Funding: ${input.fundingModel || '(unstated; do not assume a fundraising track)'}
Target customer: ${input.targetCustomer || '(unstated; keep generic — don\'t invent a wrong segment)'}
Current concern: ${input.concern || '(unstated)'}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

## EPISODE
episodeIndex: ${input.episodeIndex}

## PRIOR STORY-SO-FAR (compressed, omit if episode 0)
${input.priorStorySoFar ?? '(this is the opening episode)'}

## RECENT CHOICES${isOpening ? ' (authored scenes 1-5)' : ' (most recent episode only)'}
${formatRecentChoices(input.recentChoices)}

## TASK
${
  isOpening
    ? 'Produce the OPENING episode (5 scenes). Land on a hook so the next episode has somewhere to go — do NOT resolve the arc.'
    : `Produce episode ${input.episodeIndex} (5 more scenes). Continue from the prior storySoFar; pay off at least one beat from the most recent episode. End on a hook. Update storySoFar to cover everything before this episode.`
}

Output the JSON object now.`

  return {
    systemBlocks: [
      { text: SYSTEM_RULES, cache: false },
      { text: formatLoreBundle(input), cache: true },
    ],
    userBlocks: [{ text: userPlayerBlock, cache: false }],
  }
}
