import { ARCHETYPES } from '../archetypes'
import { filterLore } from '../lore'
import type { Archetype } from '../types'
import type { SMItem } from '../silicon-mania/types'
import type { RolledCameo, ToneSpec } from '../cameos/types'
import type { Storylet } from '../storylets/types'

export const EPISODE_LENGTH = 5

// Lore bundle still cycles through the full archetype roster so the
// prompt's flavor cache stays warm regardless of which storylets the
// engine picked. The archetype ORDER for the actual scenes is now
// driven by chosenStorylets — see SYSTEM_RULES below.
const ALL_ARCHETYPES: Archetype[] = ['cofounder', 'reporter', 'vc', 'hater', 'mentor']

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
  // Real-world SF tech-news items selected for this playthrough from the
  // Silicon Mania Weekly digest. When non-empty, they are spliced into the
  // prompt as fate so the arc can name real people verbatim.
  siliconManiaItems?: SMItem[]
  // Curated SF figures rolled per-player from /lib/cameos. Same real-name
  // override as Silicon Mania but seeded from the player's flavor tags
  // and persona, so two users almost never roll the same set.
  rolledCameos?: RolledCameo[]
  // Per-run tone, one of five categorical flavors. Spliced as a one-liner
  // into the system block to color voice without changing structure.
  tone?: ToneSpec
  // The 5 storylets the engine has already chosen for this episode.
  // The LLM does NOT pick scenes — it renders these chosen beats with
  // player-specific texture. See STORYLETS.md for rationale.
  chosenStorylets: Storylet[]
}

const SYSTEM_RULES = `You are the arc-skeleton engine for "Road to SF", a satirical comic-book founder game running in ENDLESS MODE. The story is delivered as 5-scene episodes; you produce one episode at a time.

ARCHITECTURE — THIS HAS CHANGED:
- The 5 scenes for this episode have ALREADY been selected by a deterministic storylet engine. They are supplied to you under "## CHOSEN STORYLETS" below.
- Your job is to RENDER each chosen storylet's beat as a player-specific scene beat — NOT to invent new scenes, NOT to reorder, NOT to swap archetypes.
- For each scene you produce: keep the storylet's archetype EXACTLY. Take the storylet's beat as the canonical action and rewrite it (≤220 chars) with player-specific texture (startup name, persona, target customer). You may sharpen language; you may NOT change what fundamentally happens.
- You DO write the episode's "premise" (the through-line that ties the 5 chosen storylets together) and "storySoFar" (running compressed memory).

HARD RULES:
- Output a single JSON object only. No prose before or after, no markdown fences. Start your response with "{" and end with "}".
- Numbers must be valid JSON: write 1 not +1, write 2 not +2.
- Real people are NEVER named in beats UNLESS the storylet's source beat already names them. When a chosen storylet names a real person (e.g. Peter Thiel, Sam Altman), keep the name verbatim — that's the storylet engine's intent.
- Each scene has ONE archetype as the speaker — copy from the chosen storylet exactly.
- Tone: comic, biting, cinematic. Each beat lands like a graphic novel panel.
- The story does NOT end at the close of an episode — the player chooses when to end the run. Land each episode on a hook, not a resolution.
- Each "beat" string MUST be ≤ 220 characters. One sentence preferred.

ABSOLUTE PROHIBITIONS (override anything else if they conflict):
- Do NOT swap a chosen storylet for a different beat. The selector chose these specifically for this player's state.
- Do NOT add a 6th scene. Exactly 5.
- Do NOT change a storylet's archetype.
- The cofounder archetype roster uses the label "Stranger" — not a canon first name. Never give that speaker a fixed first name unless the player's "Team" facts name someone (use that verbatim).
- If the player's Team says "solo" / "no cofounder": render a chosen cofounder storylet as written (the storylet engine has already gated for solo-vs-named appropriateness — your job is faithful rendering, not re-gating).
- If the player named a cofounder (e.g. "my cofounder Anna"), use that name verbatim where it fits the storylet.

NPC NAMING — STRICT (anti-cliché, applies to ALL beats):
- DO NOT invent first names for NPCs in beats. No "Victor the VC", no "Sandra the mentor", no "Chad the reporter". These are training-data defaults that recur across every player and break uniqueness.
- Use archetype role labels instead: "the partner", "the junior associate at the no-name fund", "the staff writer at the newsletter", "the second-time founder over coffee", "a YC batchmate", "the recruiter".
- The ONLY first names allowed in beats are those ALREADY present in the chosen storylet's source beat — those came from the cameo engine (real public figures: Thiel, Altman, Paul Graham, Garry Tan, etc.) and are deliberate.
- If the chosen storylet's source beat has no name, your rendered beat must have no name either. The texture (player startup, persona, place) goes in around the role, not on a fabricated identity.

OUTPUT SHAPE:
{
  "episodeIndex": <integer matching the input>,
  "premise": string (1-2 sentences, the through-line of THIS episode tying the 5 chosen storylets),
  "scenes": [                                     // exactly 5 entries, one per chosen storylet, in order
    {
      "index": 0..4,                              // index within this episode (matches chosen storylet order)
      "archetype": "vc"|"cofounder"|"reporter"|"hater"|"mentor",  // copy from chosen storylet
      "beat": string (≤220 chars, the rendered/personalized version of the chosen storylet's beat),
      "hingesOn": string (optional, names the prior choice this scene exploits),
      "kind": "encounter"|"solo"|"world-event"     // copy from chosen storylet's KIND note above
    }
  ],
  "storySoFar": string (REQUIRED for episodeIndex >= 1; 200 words max compressing
                        EVERYTHING that happened in prior episodes, in present-tense,
                        named-choice prose. Omit for episodeIndex 0.)
}

SOLO + WORLD-EVENT SCENE RENDERING (when KIND is not "encounter"):
- The rendered "beat" must NOT describe an NPC of the assigned archetype walking in and speaking. Instead it describes a moment, an event, or an action — the archetype is a thematic anchor only (used for image flavor downstream).
- For "solo" beats: focus on the player's interior experience or solo action. Example shape: "You sit on a bench in [place] at [time]. The [city detail]. You're [internal state]." No "X says…" anywhere in the beat.
- For "world-event" beats: focus on what changed in the world. Example shape: "[Time]. [Event]. [Visible consequence]. [What this means for the player]." May reference an NPC indirectly ("a competitor's launch post hits #1") but no NPC speaks.
- These beats CAN absolutely be the most cinematic moments in the episode. Resist the reflex to add a "and then someone called you" handoff.

Constraints by episode:
- episodeIndex = 0: "recentChoices" comes from the player's authored onboarding scenes. No priorStorySoFar.
- episodeIndex >= 1: "recentChoices" is just the last 5 (most recent episode's). Use "priorStorySoFar" for everything older. Your "storySoFar" output must extend the prior summary with the last episode's events.`

function formatRolledCameos(items: RolledCameo[]): string {
  return items
    .map(
      (c) =>
        `- ${c.displayName} (anchor: ${c.archetype}) — ${c.blurb}`,
    )
    .join('\n')
}

function formatSiliconManiaItems(items: SMItem[]): string {
  // Compact, ~400-token-bounded rendering. Each item: headline, summary,
  // and any named entities the model should drop in verbatim.
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

function formatChosenStorylets(storylets: Storylet[]): string {
  return storylets
    .map((s, i) => {
      const kind = s.kind ?? 'encounter'
      const kindNote =
        kind === 'solo'
          ? '  KIND: solo — narrator + player only, NO NPC of this archetype speaks. Render as a moment of solitude/reflection/action with the archetype as thematic flavor for image only.'
          : kind === 'world-event'
            ? '  KIND: world-event — something HAPPENS in the world the player reacts to. Narrator-led; an NPC may be referenced but does not appear as a speaking character. Archetype is thematic flavor for image only.'
            : '  KIND: encounter — the assigned archetype shows up and speaks. Standard scene.'
      return `Scene ${i} — archetype: ${s.archetype} — storylet "${s.id}"
${kindNote}
  Source beat (render this faithfully, with player-specific texture): ${s.beat}`
    })
    .join('\n')
}

function formatLoreBundle(input: BuildArcPromptInput): string {
  const lines: string[] = []
  lines.push('## CHARACTER ROSTER')
  ALL_ARCHETYPES.forEach((a) => {
    const def = ARCHETYPES[a]
    lines.push(`- ${a}: ${def.name}, ${def.title}. ${def.personality}`)
  })

  lines.push('\n## SF FLAVOR (use sparingly)')
  const seenPlaces = new Set<string>()
  const seenJokes = new Set<string>()
  const seenZ = new Set<string>()
  ALL_ARCHETYPES.forEach((a) => {
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

export function buildArcPromptParts(input: BuildArcPromptInput) {
  const isOpening = input.episodeIndex === 0

  const userPlayerBlock = `${input.tone ? `${input.tone.oneLiner}\n\n` : ''}## PLAYER STATE
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
${
  input.siliconManiaItems && input.siliconManiaItems.length > 0
    ? `
## REAL SF TECH NEWS — THIS WEEK
Real SF tech news from this week. You MUST name at least 2 of the people/companies below, BY NAME, in the scene "beat" strings. The player did not choose them; they appear as fate because they are happening right now in the city. Use real names verbatim — this overrides the "never name real people" rule for these specific items only. Pick the items that fit each archetype most naturally (a podcast cameo fits the reporter or vc; a fundraise fits the vc; a public spat fits the hater); do not force-fit.
<items>
${formatSiliconManiaItems(input.siliconManiaItems)}
</items>
`
    : ''
}${
  input.rolledCameos && input.rolledCameos.length > 0
    ? `
## ROLLED CAMEOS (this player's fate)
Three SF figures the city has decided to put in this player's path. Each is anchored to ONE archetype below. You MUST place each cameo BY NAME in their anchored archetype's scene "beat" — not in dialogue (that comes later), in the beat itself. Use the real name verbatim; this overrides the "never name real people" rule for these specific people only. The cameo's blurb is a voice/personality cue — do not paste it back; let it shape what they do in the beat.
<cameos>
${formatRolledCameos(input.rolledCameos)}
</cameos>
`
    : ''
}
## EPISODE
episodeIndex: ${input.episodeIndex}

## CHOSEN STORYLETS (already selected by the engine — render these, do not reorder or replace)
${formatChosenStorylets(input.chosenStorylets)}

## PRIOR STORY-SO-FAR (compressed, omit if episode 0)
${input.priorStorySoFar ?? '(this is the opening episode)'}

## RECENT CHOICES${isOpening ? ' (authored scenes 1-5)' : ' (most recent episode only)'}
${formatRecentChoices(input.recentChoices)}

## TASK
${
  isOpening
    ? 'Render the OPENING episode (5 scenes) from the chosen storylets above. Each scene\'s archetype matches the chosen storylet exactly; each beat is the chosen source beat re-told with this player\'s startup name and persona woven in. Write a premise that ties the 5 chosen storylets together. Land on a hook — do NOT resolve the arc.'
    : `Render episode ${input.episodeIndex} (5 scenes) from the chosen storylets above. Each scene's archetype matches the chosen storylet exactly; each beat is the chosen source beat re-told with player-specific texture. Pay off at least one beat from the most recent episode in your premise/storySoFar. End on a hook. Update storySoFar to cover everything before this episode.`
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
