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
   *  final scene. The new episode MUST be a direct consequence. */
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
  /** Storylet candidate pool — the planner may draw on these for
   *  beat ideas in arcBullets. */
  seedPool: Storylet[]
  firedSeedIds: string[]
}

const SYSTEM_RULES = `You are the EPISODE SKELETON engine for "Road to SF", a satirical comic-book founder game running in ENDLESS MODE. You produce ONE LIGHTWEIGHT skeleton per episode.

WHAT AN EPISODE IS:
- A coherent block of scenes that share ONE theme: "hackathon weekend", "Peter Thiel's office", "demo day prep", "cofounder departure crisis".
- Scenes inside the episode are NOT pre-planned by you. They are invented ON THE FLY by a downstream renderer reading your skeleton + the player's choices, scene by scene as the player plays.
- Your job is to set up the CONTAINER: the theme, the cast roster (everyone who could appear), and a rough arc of beats the renderer may draw from.

WHAT YOU PRODUCE:
- theme: the location + situation in one short phrase
- premise: 1–2 sentence through-line
- cast: the FULL speaker roster for this episode — every named character who might appear in any scene. Pre-name them all so the renderer can introduce them naturally without inventing new people.
- arcBullets: 3–5 SHORT bullet points sketching directions the episode might go. NOT scene-by-scene plans. Hints, not script. Examples: "the player might call X for help"; "Y might walk in unannounced"; "things could escalate to a public dunk"; "an unexpected text from Z could land mid-arc". Each bullet ≤ 200 chars.
- storySoFar (episodes 1+): ≤200 words extending the prior summary with this episode's intended payoff.
- seedIds: ids of storylet seeds you DREW ON for ideas (from the SEED POOL). The renderer uses these for cooldown.

CHOICE-RESPONSIVENESS (LOAD-BEARING):
- If a PRIOR-EPISODE LAST CHOICE block appears below, this episode is a DIRECT CONSEQUENCE of that choice.
- "Commit to the hackathon" → this episode IS the hackathon weekend. Cast includes teammates, judges, possibly a wandering VC. arcBullets sketch the hackathon's possible trajectories.
- "Take Thiel's offer" → this episode happens AT Thiel's office. Cast: Peter Thiel + maybe an associate. arcBullets are signing-the-term-sheet moments.
- "Fire my cofounder" → this episode is the immediate aftermath. Cast: the fired cofounder + a recruiter + a remaining team member.
- Generic themes that ignore the prior choice are wrong.

CAST ROSTER RULES:
- 2–8 named characters. Each has role (vc | cofounder | reporter | hater | mentor) + name + blurb.
- ASSIGN CONCRETE NAMES. NO placeholder names: do NOT use Sandra, Chad, Victor, Brock, Stranger.
- Real public figures verbatim ONLY when the prior choice / seed / rolled cameo named them (Peter Thiel, Sam Altman, Paul Graham, Garry Tan, etc.).
- Otherwise invent context-appropriate names.
- Pre-list everyone the renderer might need: the primary character of the episode, anyone the player might call (give them a name + blurb), anyone who might walk in unannounced. The renderer CANNOT invent new cast members on the fly — your roster is the closed set.

ARC BULLETS RULES:
- 3–5 bullets, each ≤200 chars, each a POSSIBLE beat or direction.
- They are NOT a scene order. They are a menu the renderer may pick from / interpolate between based on what the player does.
- Bullets should hint at the episode's range: a peak moment, a downside, an unexpected entrance, a quieter reflective beat.

HARD RULES:
- Output a single JSON object only. Start with "{" and end with "}". No markdown fences.
- Numbers must be valid JSON (1 not +1).
- Tone: comic, biting, cinematic.
- The episode does NOT resolve the run.

OUTPUT SHAPE:
{
  "episodeIndex": number,
  "theme": string (4–240 chars; the location + situation in one short phrase),
  "premise": string (1–2 sentences; the through-line),
  "cast": [
    { "role": "vc"|"cofounder"|"reporter"|"hater"|"mentor", "name": string, "blurb"?: string (voice/personality, ≤300 chars) }
  ],
  "arcBullets": [string],   // 3–5 short directions the episode may go (≤200 chars each); NOT scene plans
  "storySoFar": string (REQUIRED for episodeIndex ≥ 1; ≤200 words),
  "seedIds": [string]        // ids of storylet seeds you drew on; renderer uses for cooldown
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

  lines.push('\n## SF FLAVOR (use sparingly — for cast + arc bullets)')
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
- "Commit to the hackathon" → THIS EPISODE *IS* the hackathon weekend. Cast includes teammates + judges. arcBullets sketch the weekend's possible peaks.
- "Take Thiel's offer" → THIS EPISODE happens AT Thiel's office. Cast: Peter Thiel + an associate maybe.
- "Fire my cofounder" → THIS EPISODE is the immediate aftermath: the empty desk, the recruiter, the standup that doesn't happen.
- "Submit to YC" → THIS EPISODE is the YC interview day.
- "Walk away" → THIS EPISODE is what the player does NEXT — the bench at Dolores Park, the call to a friend, the pivot.

Generic themes that ignore the prior choice are wrong. The theme NAMES the consequence.`
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
You MUST name at least one of the people/companies below verbatim, in either the theme or one cast member. Real names override the "no fabricated names" rule for these specific items only.
<items>
${formatSiliconManiaItems(input.siliconManiaItems)}
</items>
`
    : ''
}${
  input.rolledCameos && input.rolledCameos.length > 0
    ? `
## ROLLED CAMEOS (this player's fate)
SF figures the city has decided to put in this player's path. Place AT LEAST ONE by name in this episode's cast. Real names verbatim.
<cameos>
${formatRolledCameos(input.rolledCameos)}
</cameos>
`
    : ''
}
## EPISODE
episodeIndex: ${input.episodeIndex}

## SEED POOL (for inspiration on possible beats — populate arcBullets / cast hints from these)
Already-used seeds you should NOT lean on again: ${input.firedSeedIds.length === 0 ? '(none)' : input.firedSeedIds.join(', ')}
${formatSeedPool(input.seedPool)}

## PRIOR STORY-SO-FAR (compressed, omit if episode 0)
${input.priorStorySoFar ?? '(this is the opening episode)'}

## RECENT CHOICES${isOpening ? ' (authored scenes 1-5)' : ' (most recent episode only)'}
${formatRecentChoices(input.recentChoices)}

## TASK
Plan ONE EPISODE SKELETON. Output:
- theme (consequence of the prior choice; see directive above)
- premise (1–2 sentences)
- cast (2–8 named characters with role + name + blurb — the closed set the renderer can draw from for the whole episode)
- arcBullets (3–5 short directions the episode may go — NOT scene plans, just hints for the renderer)
- storySoFar (episodes ≥1)
- seedIds (the storylet seed ids you drew on for ideas)

The renderer will invent each scene's setting + dialogue + choices + imagePrompt fresh from this skeleton + the player's choices. Do not pre-plan scenes.

Output the JSON object now.`

  return {
    systemBlocks: [
      { text: SYSTEM_RULES, cache: false },
      { text: formatLoreBundle(input), cache: true },
    ],
    userBlocks: [{ text: userBlock, cache: false }],
  }
}
