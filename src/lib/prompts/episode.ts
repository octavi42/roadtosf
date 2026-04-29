import { ROLES } from '../archetypes'
import { filterLore } from '../lore'
import type { Role } from '../types'
import type { SMItem } from '../silicon-mania/types'
import type { RolledCameo, ToneSpec } from '../cameos/types'
import type { Storylet } from '../storylets/types'

const ALL_ROLES: Role[] = ['cofounder', 'reporter', 'vc', 'hater', 'mentor']

export interface PriorChoiceSummary {
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildEpisodePromptInput {
  episodeIndex: number
  priorStorySoFar?: string
  /** The single most-recent player choice from the prior episode's
   *  final scene. The new episode MUST be a direct consequence of
   *  this choice — if the player committed to attend a hackathon, the
   *  next episode IS the hackathon. */
  lastChoice?: PriorChoiceSummary
  startupName: string
  startupDescription: string
  founderPersona: string
  stage?: string
  team?: string
  fundingModel?: string
  targetCustomer?: string
  concern?: string
  flavorTags: string[]
  recentChoices: PriorChoiceSummary[]
  currentStats: { hype: number; integrity: number }
  seed?: string
  todayISO: string
  siliconManiaItems?: SMItem[]
  rolledCameos?: RolledCameo[]
  tone?: ToneSpec
  /** A pool of storylet seeds the planner may draw from. The planner
   *  picks 3–5 to compose the episode; ids it picks must come back in
   *  the response under `seedIds`. */
  seedPool: Storylet[]
  /** Cross-episode cooldown — already-fired seed ids; the seedPool
   *  filter excludes these on the way in, but the prompt also calls
   *  out the contract for clarity. */
  firedSeedIds: string[]
}

const SYSTEM_RULES = `You are the EPISODE PLANNER for "Road to SF", a satirical comic-book founder game running in ENDLESS MODE. You produce ONE EPISODE at a time.

WHAT AN EPISODE IS:
- An episode is a coherent block of 3–5 scenes that share ONE overarching THEME (e.g. "hackathon weekend", "demo day prep", "cofounder departure crisis", "Peter Thiel's office", "scaling-bug all-nighter").
- The theme defines a LOCATION and an EVENT. Every scene in the episode happens AT THAT LOCATION or as a direct consequence of THAT EVENT.
- Scenes are MOMENTS within the episode: "brainstorming with my team", "pitching the jury", "Peter Thiel walks over", "fixing the bug at 4am", "Q&A with the press".

CHOICE-RESPONSIVENESS (LOAD-BEARING — the whole point):
- The PRIOR EPISODE'S LAST CHOICE is the dominant input. The new episode MUST be a direct consequence.
- If the player committed to attend a hackathon → the next episode IS the hackathon.
- If they took a meeting at Peter Thiel's office → the next episode happens IN that office (or in its immediate aftermath).
- If they fired their cofounder → the next episode is the immediate fallout (the empty desk, the recruiter's call, the standup that doesn't happen).
- Generic, unrelated themes ("a coffee with a VC", "a tweet went viral") are FAILURES of choice-responsiveness. Reject the easy default.

CAST (multi-role scenes are ALLOWED):
- Each scene has a primary "role" (one of: vc | cofounder | reporter | hater | mentor) and a "cast" of named characters who could plausibly speak in that scene.
- Multiple roles can be present and speak in a single scene. A hackathon scene might list cofounder + competitor + mentor in cast. A Thiel-office scene might list vc (Thiel) and the player only.
- ASSIGN CONCRETE NAMES to cast members. NO placeholder names: do NOT use Sandra, Chad, Victor, Brock, Stranger — those are forbidden defaults that recur across every player.
- Real public figures are allowed VERBATIM when the seed beat or rolled cameos already named them (Peter Thiel, Sam Altman, Paul Graham, Garry Tan, Marc Andreessen, etc.).
- Otherwise: invent context-appropriate names that fit the persona (a YC partner over coffee → name them; a competitor's CEO → give them a name; a recruiter's voice on the phone → give them a name).
- Each scene's cast carries forward across the episode where it makes sense. If "Maya" is the cofounder candidate in scene 0, she's still Maya in scene 2 — same role + same name.

PRE-FIXED SETTING + IMAGE:
- Each scene must commit to a SETTING ("the YC co-working space, 7pm Friday", "Peter Thiel's office at Founders Fund", "Caltrain car, 4:35pm") and an IMAGE PROMPT (≤220 chars, no style words — the renderer prepends those).
- Setting and imagePrompt are committed at episode-gen time. Scene-gen does NOT change them — Haiku only writes dialogue + choices reading the pre-fixed setting.

SEED POOL:
- You receive a SEED POOL of 3–6 storylets (see ## SEED POOL below). These are pre-authored beats the engine has gated by player state.
- Pick 3–5 from the pool that fit the chosen theme. If a seed doesn't fit the theme, DROP IT — picking off-theme is worse than reusing one less seed.
- Return the picked storylet ids in "seedIds" (in scene order). Each scene corresponds to one picked seed.
- You may sharpen the seed's beat with player-specific texture (startup name, persona, target customer). You may NOT change what fundamentally happens in the seed.

HARD RULES:
- Output a single JSON object only. No prose before or after, no markdown fences. Start with "{" and end with "}".
- Numbers must be valid JSON (1 not +1).
- 3 to 5 scenes. Pick what serves the theme. Default to 4 unless 3 or 5 is clearly better.
- Tone: comic, biting, cinematic. Each scene reads like a graphic-novel panel.
- The episode does NOT resolve the run — leave a hook for the next episode.

OUTPUT SHAPE:
{
  "episodeIndex": number,
  "theme": string (4-160 chars; the location + event in one short phrase),
  "premise": string (1-2 sentences; the through-line),
  "scenes": [
    {
      "index": 0..(N-1),
      "role": "vc"|"cofounder"|"reporter"|"hater"|"mentor",
      "setting": string (≤280 chars; concrete time + place),
      "cast": [
        { "role": same enum, "name": string, "blurb"?: string (voice/personality, ≤220 chars) }
      ],
      "beat": string (≤400 chars; what happens in this scene),
      "kind": "encounter"|"solo"|"world-event" (optional),
      "imagePrompt": string (≤220 chars; setting + character action + mood + composition. NO style words.)
    }
  ],
  "storySoFar": string (REQUIRED for episodeIndex >= 1; ≤200 words; named-choice prose extending the prior summary with this episode's payoff),
  "seedIds": [string]   // ids of the storylet seeds you picked, IN SCENE ORDER
}`

function formatRolledCameos(items: RolledCameo[]): string {
  return items
    .map((c) => `- ${c.displayName} (anchor: ${c.archetype}) — ${c.blurb}`)
    .join('\n')
}

function formatSiliconManiaItems(items: SMItem[]): string {
  return items
    .map((it) => {
      const named: string[] = []
      if (it.people.length) named.push(`people: ${it.people.join(', ')}`)
      if (it.companies.length) named.push(`companies: ${it.companies.join(', ')}`)
      if (it.vcs.length) named.push(`vcs: ${it.vcs.join(', ')}`)
      const namedLine = named.length ? `\n  ${named.join(' | ')}` : ''
      const cat = it.category ? ` [${it.category}]` : ''
      return `- ${it.headline}${cat}\n  ${it.summary}${namedLine}`
    })
    .join('\n')
}

function formatRecentChoices(choices: PriorChoiceSummary[]): string {
  if (choices.length === 0) return '(none)'
  return choices
    .map(
      (c) =>
        `Scene ${c.sceneId}: chose "${c.choiceLabel}" (hype ${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}, integrity ${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta})`,
    )
    .join('\n')
}

function formatSeedPool(seeds: Storylet[]): string {
  return seeds
    .map((s) => {
      const kind = s.kind ?? 'encounter'
      return `- id: ${s.id}
  role: ${s.archetype}   kind: ${kind}
  beat: ${s.beat}`
    })
    .join('\n')
}

function formatRoleGlossary(): string {
  return ALL_ROLES.map((r) => {
    const def = ROLES[r]
    return `- ${r}: ${def.roleLabel} — ${def.title}. ${def.personality}`
  }).join('\n')
}

function formatLoreBundle(input: BuildEpisodePromptInput): string {
  const lines: string[] = []
  lines.push('## ROLE GLOSSARY')
  lines.push(formatRoleGlossary())

  lines.push('\n## SF FLAVOR (use sparingly)')
  const seenPlaces = new Set<string>()
  const seenJokes = new Set<string>()
  const seenZ = new Set<string>()
  ALL_ROLES.forEach((a) => {
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
  return lines.join('\n')
}

function formatLastChoiceCallout(c?: PriorChoiceSummary): string {
  if (!c) {
    return `## EPISODE THEME DIRECTIVE
This is the OPENING episode after the player's authored intro. Pick a theme that fits the player's startup, persona, and stage — a credible "first day on the ground in SF" beat. Default candidates: a hackathon weekend, a YC co-working space morning, a first investor meeting, a cofounder pitch over coffee.`
  }
  const hypeStr = `${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}`
  const integStr = `${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta}`
  return `## EPISODE THEME DIRECTIVE — THE CHOICE THAT BUILDS THIS EPISODE
At the end of the prior episode, the player chose: "${c.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr}.

THIS EPISODE IS A DIRECT CONSEQUENCE of that choice. Pick a theme that *is* the consequence:
- "Commit to the hackathon" → THIS EPISODE *IS* the hackathon weekend.
- "Take Thiel's offer" → THIS EPISODE happens AT Thiel's office, signing the term sheet.
- "Fire my cofounder" → THIS EPISODE is the immediate aftermath — the empty desk, the legal call, the all-hands.
- "Submit to YC" → THIS EPISODE is the YC interview day.
- "Walk away" → THIS EPISODE is what the player does NEXT — the bench at Dolores Park, the call to a friend, the pivot.

Generic themes that ignore the prior choice are wrong. Bad theme: "a VC dinner". Good theme (after "commit to the hackathon"): "Hackathon weekend at the YC co-working space, 56 hours to ship". The theme NAMES the consequence.`
}

export function buildEpisodePromptParts(input: BuildEpisodePromptInput) {
  const isOpening = input.episodeIndex === 0

  const userBlock = `${input.tone ? `${input.tone.oneLiner}\n\n` : ''}${formatLastChoiceCallout(input.lastChoice)}

## PLAYER STATE
Startup: ${input.startupName}
Pitch: ${input.startupDescription || '(unstated)'}
Founder vibe: ${input.founderPersona || '(unstated)'}
Stage: ${input.stage || '(unstated)'}
Flavor tags: ${input.flavorTags.length ? input.flavorTags.join(', ') : '(none)'}

## PLAYER FACTS (HONOR THESE — never invent contradictions)
Team: ${input.team || '(unstated; treat as solo)'}
Funding: ${input.fundingModel || '(unstated)'}
Target customer: ${input.targetCustomer || '(unstated)'}
Current concern: ${input.concern || '(unstated)'}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.
${
  input.siliconManiaItems && input.siliconManiaItems.length > 0
    ? `
## REAL SF TECH NEWS — THIS WEEK
You MUST name at least one of the people/companies below verbatim, in either the theme or one scene's cast. Real names override the "no fabricated names" rule for these specific items only.
<items>
${formatSiliconManiaItems(input.siliconManiaItems)}
</items>
`
    : ''
}${
  input.rolledCameos && input.rolledCameos.length > 0
    ? `
## ROLLED CAMEOS (this player's fate)
SF figures the city has decided to put in this player's path. Place AT LEAST ONE by name in this episode's cast (ideally as the named character of their anchored role's scene). Real names verbatim.
<cameos>
${formatRolledCameos(input.rolledCameos)}
</cameos>
`
    : ''
}
## EPISODE
episodeIndex: ${input.episodeIndex}

## SEED POOL (pick 3–5 that fit your chosen theme)
Already-fired seeds you must NOT pick again: ${input.firedSeedIds.length === 0 ? '(none)' : input.firedSeedIds.join(', ')}
${formatSeedPool(input.seedPool)}

## PRIOR STORY-SO-FAR (compressed, omit if episode 0)
${input.priorStorySoFar ?? '(this is the opening episode)'}

## RECENT CHOICES${isOpening ? ' (authored scenes 1-5)' : ' (most recent episode only)'}
${formatRecentChoices(input.recentChoices)}

## TASK
Plan ONE episode (3–5 scenes). The theme MUST be a consequence of the prior choice (see directive above). For each scene: pick a seed from the pool, commit to a setting, name the cast (real public figures verbatim where the seed/cameo named them; otherwise context-appropriate invented names — never Sandra/Chad/Victor/Brock/Stranger), write the beat, write a ≤220 char imagePrompt, set the role + kind. Return the picked seed ids in "seedIds" in scene order.

Output the JSON object now.`

  return {
    systemBlocks: [
      { text: SYSTEM_RULES, cache: false },
      { text: formatLoreBundle(input), cache: true },
    ],
    userBlocks: [{ text: userBlock, cache: false }],
  }
}
