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
  /** The single most-recent player choice from the prior episode. */
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
  seedPool: Storylet[]
  firedSeedIds: string[]
}

const SYSTEM_RULES = `You are the EPISODE PLANNER for "Road to SF", a satirical comic-book founder game. You produce ONE episode at a time.

WHAT AN EPISODE IS:
- A coherent block of 3–5 SCENES that share a theme: "hackathon weekend", "Peter Thiel's office", "demo day prep", "cofounder departure crisis".
- Each SCENE is a single LOCATION + a SUBSET of named characters from the episode's cast roster + a topic / what happens there.
- Inside each scene the player will play through MULTIPLE BEATS (dialogue + choice cycles). The image, location, and cast STAY PUT for the whole scene; only dialogue + choices change as the player makes choices.
- Your job is to lock down the CONTAINERS: theme, episode-level cast roster, and 3–5 scene plans (setting / cast subset / imagePrompt / topic / title each).

WHAT YOU PRODUCE:
- theme: the episode's location + situation in one short phrase
- premise: 1–2 sentence through-line
- cast: 2–8 named characters total — the FULL roster for the whole episode. Every named character a downstream renderer might need MUST appear here.
- scenes[3–5]: each scene plan has setting / cast (subset) / imagePrompt / topic / title. The player walks through these scenes in order; each scene is a container for many beats of dialogue.
- storySoFar (episodes 1+): ≤200 words extending the prior summary.
- seedIds: storylet seed ids you drew on for ideas (used for cooldown).

CHOICE-RESPONSIVENESS (LOAD-BEARING):
- If a PRIOR-EPISODE LAST CHOICE block appears below, this episode is a DIRECT CONSEQUENCE of that choice.
- "Commit to the hackathon" → this episode IS the hackathon weekend. Scene 1 = main floor with the team. Scene 2 = pitching the jury. Scene 3 = a quiet corner with a mentor. Scene 4 = the awards.
- "Take Thiel's offer" → this episode is at Thiel's office. Scenes are: the meeting, the contract, the walk-out, the call back home.
- "Fire my cofounder" → immediate aftermath. Scenes: the empty desk, the recruiter call, the standup, the late-night doubt.

CAST ROSTER RULES:
- 2–8 named characters at episode level. Each scene's "cast" field is a SUBSET of these names — never names not in the episode roster.
- ASSIGN CONCRETE NAMES. NO placeholder names: do NOT use Sandra, Chad, Victor, Brock, Stranger.
- Cast members carry through scenes: if "Maya" is the cofounder candidate in scene 1, she's still Maya in scene 3.

FAMOUS-FIGURE BUDGET (LOAD-BEARING — most-broken rule, do NOT relax):
- AT MOST 1 cast member per episode may be a real, recognizable public figure (Sam Altman, Peter Thiel, Patrick Collison, Vinod Khosla, Marc Andreessen, Reid Hoffman, Garry Tan, Eric Newcomer, etc.).
- If a "ROLLED CAMEOS" block appears below, that is your ONE allowed real-figure slot for this episode. Pick AT MOST ONE name from it. The other rolled cameos are reserved for future episodes — do not use them this episode.
- ALL OTHER cast members MUST be invented SF personas: plausible first/last names like Maya Chen, Dev Iyer, Sasha Park, Tomas Novak, Annie Zhao, Rohan Mehta, Ella Rodriguez. Do NOT invent additional real figures from your training data — even if a player's flavor tags mention "Sequoia" or "a16z", make up an associate name, do not name Roelof Botha or Marc Andreessen.
- Why this matters: meeting Patrick Collison + Vinod Khosla + Eric Newcomer in one episode breaks the satire and dilutes the personalization payoff. Famous cameos hit harder when they're rare. Spread them across episodes; populate this episode's cast with believable randos.
- News items in the SF TECH NEWS section may be referenced via company name (Stripe, OpenAI, Anthropic) without counting against the budget. Naming a specific person from a news item IS a famous-figure mention and counts.

CAST IDENTITY (LOAD-BEARING for voice + image consistency):
- The episode-level "cast" is the source of truth. Each member there MUST include "gender", "age", "descriptives", and "appearance".
- Each scene's "cast" subset emits ONLY { role, name, blurb? } — the server mirrors gender/age/descriptives/appearance from the episode roster by matching name. Do NOT duplicate the identity fields in scene cast subsets; doing so is wasted output and slows generation.
- gender: "male" | "female" | "neutral". Real public figures: use real-world gender (Peter Thiel = male, Sarah Tavel = female, Sam Altman = male, Cathie Wood = female). For invented names, pick to fit the role + name; aim for a balanced cast (do NOT make every VC male or every cofounder female).
- age: "young" (≤30s) | "middle" (40s-50s) | "old" (60+). Peter Thiel = middle, Paul Graham = middle, Vinod Khosla = old, a typical YC batch cofounder = young.
- descriptives: 3-5 short voice/personality adjectives that will steer ElevenLabs voice picking. Examples:
    Peter Thiel → ["deep","measured","patrician"]
    Sam Altman → ["calm","clipped","understated"]
    a young hacker cofounder → ["fast","nervous","energetic"]
    a tired YC partner → ["warm","weathered","calm"]
  Use ONLY voice/delivery descriptors (deep, fast, calm, raspy, bright, dramatic, conversational). NOT bio descriptors (smart, founder, ex-Stripe).
- appearance: ONE compact physical description (≤200 chars) — clothing, hair, build, signature features. The SAME character must have the SAME appearance string in every scene they appear in. This is what image-gen uses to keep them visually consistent. Examples:
    Peter Thiel → "balding, lean, dark suit jacket, no tie, slight stoop, intense pale eyes"
    Sam Altman → "shaved head, plain dark t-shirt, slight smile, narrow grey eyes"
    Maya (invented young cofounder) → "Asian woman late 20s, dark hoodie over band tee, short ponytail, laptop covered in stickers"
    Linda (invented older YC partner) → "white woman 60s, grey bob, glasses on a chain, cardigan, holding a hardback book"
  Describe what a stranger would see — NOT personality. NEVER mention real-world identifying details that could ID a non-public person (full name + employer + face, etc.).

SCENE PLAN RULES:
- 3–5 scenes per episode. Each scene =
    * setting: concrete time + place ("the YC kitchen, 11pm Tuesday"; "Peter Thiel's office at Founders Fund, 4pm")
    * cast: 1–4 characters from the episode roster (a 1-character intimate scene is fine; a 4-character "everyone's at the hackathon" scene is fine)
    * topic: 1 sentence on what this scene is about ("the player is brainstorming with the team late at night and getting a chance encounter with a wandering judge")
    * imagePrompt: ≤220 chars; setting + character action + mood + composition. NO style words.
    * title: short nameplate string for the UI ("The Kitchen Argument", "Thiel's Office", "Demo Day Walk-Out")

NARRATIVE FLOW BETWEEN SCENES (LOAD-BEARING):
- Each scene is a CONSEQUENCE of the previous scene's likely outcome. NOT a disconnected next-cast-member encounter.
- Scene 2's setting + cast must be a credible place the player ENDS UP after scene 1's likely choices, NOT a location-jump that requires teleportation.
- Bad example: scene 1 is "Sam Altman tells you to call Priya." Scene 2 is "Reid Hoffman in his Greylock office." This is disconnected — the player just committed to calling Priya; how did they end up at Greylock?
- Good example: scene 1 is "Sam Altman tells you to call Priya." Scene 2 is "Priya picks up — phone call from the player's car / her apartment / a quiet table somewhere." Scene 3 is "Priya and the player walking together toward the next thing." THE EPISODE FLOWS.
- Cast members carrying through scenes is a feature: if Priya is in scene 1, she can show up in scene 2, scene 3, scene 4 (in different settings). It builds continuity.
- One way to think about it: design scenes as ACTS in a single 30-minute story. Act 1 sets up; act 2 deepens; act 3 escalates; act 4 resolves. Not four disconnected vignettes.
- Anchor each subsequent scene's setting and cast to a specific OUTCOME from the prior scene that's likely or implied. The renderer can pivot if the player's actual choice diverges, but your default plan should be coherent.

HARD RULES:
- Output a single JSON object only. No markdown fences. Start with "{" and end with "}".
- Numbers must be valid JSON.
- Tone: comic, biting, cinematic.
- The episode does NOT resolve the run.

JSON STRING SAFETY (the most-broken rule, do not relax):
- Inside any string field (theme, premise, setting, topic, blurb, title, storySoFar, etc.) NEVER use the " character to quote in-text speech or thoughts.
- Use single quotes (') or em-dashes (—) for any in-text quotation. Bad: "blurb": "Tweets things like \\"compliance is a feature.\\"" Good: "blurb": "Tweets things like 'compliance is a feature.'"
- Apostrophes in regular prose are fine (it's, don't, she's). Only the " character is the problem.
- Every unescaped " inside a string field breaks the JSON parser and forces the whole episode to fall back. Do not include "double quotes" in any string value.

OUTPUT SHAPE:
{
  "episodeIndex": number,
  "theme": string (≤240 chars),
  "premise": string (1–2 sentences),
  "cast": [
    {
      "role": "vc"|"cofounder"|"reporter"|"hater"|"mentor",
      "name": string,
      "blurb"?: string (≤300 chars),
      "gender": "male"|"female"|"neutral",
      "age": "young"|"middle"|"old",
      "descriptives": [string, ...],  // 3-5 voice adjectives
      "appearance": string (≤200 chars; physical description)
    }
  ],
  "scenes": [
    {
      "index": 0..(N-1),
      "role": "vc"|"cofounder"|"reporter"|"hater"|"mentor",
      "setting": string (≤600 chars; concrete time + place),
      "cast": [ { "role": ..., "name": <name from episode roster>, "blurb"?: string } ],   // ONLY role/name/blurb — identity fields mirror server-side
      "topic": string (≤400 chars; what happens here),
      "imagePrompt": string (≤220 chars; NO style words),
      "title": string (≤120 chars; short nameplate)
    }
  ],
  "storySoFar": string (REQUIRED for episodeIndex ≥ 1; ≤200 words),
  "seedIds": [string]
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
This is the OPENING episode after the player's authored intro. Pick a theme that fits the player's startup, persona, and stage. Default candidates: a hackathon weekend, a YC co-working space night, a first investor meeting.`
  }
  const hypeStr = `${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}`
  const integStr = `${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta}`
  return `## EPISODE THEME DIRECTIVE — THE CHOICE THAT BUILDS THIS EPISODE
At the end of the prior episode, the player chose: "${c.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr}.

THIS EPISODE IS A DIRECT CONSEQUENCE. Pick a theme that *is* the consequence — the location and cast the choice took the player to.`
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
You MUST name at least one of the people/companies below verbatim. Real names override the "no fabricated names" rule for these specific items only.
<items>
${formatSiliconManiaItems(input.siliconManiaItems)}
</items>
`
    : ''
}${
  input.rolledCameos && input.rolledCameos.length > 0
    ? `
## ROLLED CAMEOS (this player's fate — pool of ${input.rolledCameos.length}; use AT MOST ONE this episode)
SF figures the city has reserved for this run. Pick AT MOST ONE to cast in this episode by name. The unused ones are for future episodes — do NOT cram multiple into a single episode (see FAMOUS-FIGURE BUDGET above). It is also OK to use ZERO this episode and lean entirely on invented SF personas.
<cameos>
${formatRolledCameos(input.rolledCameos)}
</cameos>
`
    : ''
}
## EPISODE
episodeIndex: ${input.episodeIndex}

## SEED POOL (for inspiration on possible beats / cast)
Already-used seeds you should NOT lean on again: ${input.firedSeedIds.length === 0 ? '(none)' : input.firedSeedIds.join(', ')}
${formatSeedPool(input.seedPool)}

## PRIOR STORY-SO-FAR (compressed, omit if episode 0)
${input.priorStorySoFar ?? '(this is the opening episode)'}

## RECENT CHOICES${isOpening ? ' (authored scenes 1-5)' : ' (most recent episode only)'}
${formatRecentChoices(input.recentChoices)}

## TASK
Plan the episode skeleton:
- theme + premise (consequence of prior choice; see directive above)
- cast (2–8 named characters — episode-level roster)
- scenes[3–5] (each: setting + cast subset + imagePrompt + topic + title; locked at episode-gen, NOT mutable mid-episode)
- storySoFar (episodes ≥1)
- seedIds

The renderer will play each scene as a stream of beats (dialogue + choices generated on the fly per choice click). Your job is the CONTAINER: the locations, the cast, the rough trajectory.

Output the JSON object now.`

  return {
    systemBlocks: [
      { text: SYSTEM_RULES, cache: false },
      { text: formatLoreBundle(input), cache: true },
    ],
    userBlocks: [{ text: userBlock, cache: false }],
  }
}
