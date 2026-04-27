import { ARCHETYPES } from '../archetypes'
import { filterLore } from '../lore'
import type { Archetype } from '../types'

// Each group has 4 scenes; the 4 archetypes per group are fixed so visual /
// voice consistency is guaranteed across runs. The LLM only gets to write
// dialogue/choices/imagePrompt — never to pick which archetype shows up.
export const GROUP_SCENE_ARCHETYPES: Record<number, Archetype[]> = {
  1: ['cofounder', 'reporter', 'vc', 'cofounder'],
  2: ['hater', 'mentor', 'vc', 'reporter'],
  3: ['cofounder', 'mentor', 'hater', 'mentor'],
}

export interface PriorChoice {
  groupIndex: number
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildGroupPromptInput {
  groupIndex: number // 1, 2, 3
  startupName: string
  startupDescription: string
  founderPersona: string
  flavorTags: string[]
  priorChoices: PriorChoice[]
  storySoFar?: string
  currentStats: { hype: number; integrity: number }
  seed?: string
  todayISO: string
}

export interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM = `You are the story-generation engine for "Road to SF", a one-shot satirical comic-book game about a founder's first day in San Francisco.

HARD RULES — break any of these and the response is rejected:
- Output a single JSON object. No prose, no markdown fences. The user message will start your response with an opening "{".
- Tone: comic, satirical, cinematic. Punchy lines. Dialogue lands like a graphic novel panel — never academic.
- Dialogue lines: 2–6 per scene, each ≤280 chars. Cap to 1–2 sentences each.
- Choice labels: 2–3 per scene, each ≤8 words, action-flavored (verbs first when possible).
- Stat deltas: hype and integrity each ∈ {-2, -1, 0, +1, +2}. Most choices should sit at ±1 with the occasional ±2 for dramatic forks. 0 is allowed for symbolic deltas (e.g. lying without immediate hype payoff).
- Real people are NEVER named. Use archetypes ("a Thiel-coded VC", "a Sam-coded accelerator partner", "the YC partner with the blog"). Real PLACES (Tartine, Caltrain, Rosewood Sand Hill, YC) ARE allowed.
- imagePrompt: ≤220 chars. Describe ONLY setting + character action + mood + composition. NEVER include style words (cel-shaded, illustration, comic, etc.) — the renderer prepends those.

SCENE GRAMMAR:
- Each scene fixes one archetype as the speaker (already assigned to you per scene). The player is reactive — choices come from the player's POV.
- Choice IDs are short ("a", "b", "c"). Set timeoutChoiceId to one of them — the "default" choice that fires if the player hesitates.
- timeoutSeconds: 12–18 (default 15).

GROUP STRUCTURE:
- Exactly 4 scenes per group.
- twistCard: a single sentence (≤220 chars) that closes the group with an in-world beat. It is shown as a full-screen narrative panel — no dialogue. Must reference the most recent choice as a post-hoc patch.

OUTPUT SHAPE (TypeScript):
{
  "id": <groupIndex>,
  "twistCard": string,
  "scenes": [
    {
      "id": number,
      "title": string,
      "archetype": "vc" | "cofounder" | "reporter" | "hater" | "mentor",
      "imagePrompt": string,
      "dialogue": [{ "speaker": "<archetype>"|"player"|"narrator", "text": string }],
      "choices": [{ "id": "a"|"b"|"c", "label": string, "consequence": string, "hype": number, "integrity": number }],
      "timeoutSeconds": number,
      "timeoutChoiceId": "a"|"b"|"c"
    } x4
  ]
}`

function formatLoreBlock(input: BuildGroupPromptInput): string {
  const archetypes = GROUP_SCENE_ARCHETYPES[input.groupIndex] ?? GROUP_SCENE_ARCHETYPES[1]
  const lines: string[] = []
  lines.push('## SCENE ARCHETYPE ASSIGNMENTS (fixed)')
  archetypes.forEach((a, i) => {
    const def = ARCHETYPES[a]
    lines.push(`Scene ${i + 1}: ${def.name} (${a}) — ${def.title}. ${def.personality}`)
  })

  lines.push('\n## SF LORE (use sparingly; let the world feel like fate, not a tour)')
  // Pull a different lore subset per archetype to surface variety across scenes.
  const seenPlaces = new Set<string>()
  const seenJokes = new Set<string>()
  const seenZ = new Set<string>()
  archetypes.forEach((a, i) => {
    const lore = filterLore({
      flavorTags: input.flavorTags,
      sceneArchetype: a,
      todayISO: input.todayISO,
      seed: input.seed,
      maxPlaces: 3,
      maxJokes: 2,
      maxZeitgeist: 2,
    })
    lines.push(`\nFor Scene ${i + 1} (${a}):`)
    lore.places.forEach((p) => {
      if (seenPlaces.has(p.id)) return
      seenPlaces.add(p.id)
      lines.push(`  • Place: ${p.name} — ${p.vibe}`)
    })
    lore.jokes.forEach((j) => {
      if (seenJokes.has(j.id)) return
      seenJokes.add(j.id)
      lines.push(`  • Running joke (${j.tone}): ${j.beat}`)
    })
    lore.zeitgeist.forEach((z) => {
      if (seenZ.has(z.id)) return
      seenZ.add(z.id)
      lines.push(`  • Current beat (${z.tone}): ${z.beat}`)
    })
  })
  return lines.join('\n')
}

function formatPriorChoices(choices: PriorChoice[]): string {
  if (choices.length === 0) return '(none — this is the opening group)'
  return choices
    .map(
      (c) =>
        `Group ${c.groupIndex}, Scene ${c.sceneId}: chose "${c.choiceLabel}" (hype ${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}, integrity ${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta})`,
    )
    .join('\n')
}

export function buildGroupPrompt(input: BuildGroupPromptInput): BuiltPrompt {
  const opener = input.groupIndex === 1
    ? 'This is the OPENING group. Set the world. The player just landed at SFO 6 hours ago. Their co-founder is already texting.'
    : `This is Group ${input.groupIndex} of 3. Continue from the prior group's twist card. Pay it off in Scene 1.`

  const user = `# Generate Group ${input.groupIndex}

## STARTUP
Name: ${input.startupName}
Pitch: ${input.startupDescription}

## FOUNDER PERSONA
${input.founderPersona || '(unstated — infer a default first-time founder vibe)'}

## FLAVOR TAGS (player intro signal)
${input.flavorTags.length > 0 ? input.flavorTags.join(', ') : '(none)'}

## PRIOR CHOICES
${formatPriorChoices(input.priorChoices)}

## STORY-SO-FAR (compressed from prior groups)
${input.storySoFar ?? '(this is the first group)'}

## CURRENT STATS
hype: ${input.currentStats.hype}, integrity: ${input.currentStats.integrity}

${formatLoreBlock(input)}

## TASK
${opener} Produce a 4-scene group with a twist card. Make every choice feel like it has weight. Land at least one cameo place from the lore block above. The twist card must reference Scene 4's choice as fate.

Begin output with the JSON object.`

  return { system: SYSTEM, user }
}
