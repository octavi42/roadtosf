import { ROLES } from '../archetypes'
import type { Episode, Role } from '../types'
import { MAX_DIALOGUE_CHARS_PER_SCENE } from '../schemas/scene'
import type { ToneSpec } from '../cameos/types'

export interface PriorChoiceSummary {
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildScenePromptInput {
  /** Currently-playing episode skeleton — theme + cast roster +
   *  arcBullets. Provides container; does NOT pre-plan scenes. */
  episode: Episode
  /** Index of THIS scene within the episode (0-based). */
  sceneIndexInEpisode: number
  /** Total scenes the player has seen so far in this episode (for
   *  prompt context — "this is your 4th scene of the episode"). */
  totalScenesInEpisodeSoFar: number
  /** The single most-recent choice the player made — usually the
   *  prior scene's pick. The load-bearing input for choice-driven
   *  scene flow: this scene is a direct consequence of it. */
  lastChoice?: PriorChoiceSummary
  /** 1-based id within the full playthrough. */
  sceneId: number
  storySoFar?: string
  startupName: string
  founderPersona: string
  team?: string
  fundingModel?: string
  targetCustomer?: string
  concern?: string
  recentChoices: PriorChoiceSummary[]
  currentStats: { hype: number; integrity: number }
  tone?: ToneSpec
}

const SCENE_SYSTEM_RULES = `You are the per-scene engine for "Road to SF", a satirical comic-book founder game running in ENDLESS MODE. You produce ONE SCENE at a time, fresh — setting, cast subset, dialogue, choices, imagePrompt all generated on the fly from the episode skeleton + the player's prior choice.

WHAT A SCENE IS:
- ONE moment within the episode. A single dialogue exchange leading to one decision point.
- 2–4 dialogue lines, then 2–3 choice options for the player.
- The setting is whatever fits THIS moment (the same room, a new room, a phone call, an alleyway — whatever the prior choice took the player to).
- The scene ends when the player picks a choice; the next scene begins (or, if you mark this scene as the episode's last, a new episode begins).

CHOICE-RESPONSIVENESS (LOAD-BEARING):
- The player's PRIOR CHOICE is the dominant input. THIS SCENE is the direct consequence.
- "Call Priya" → THIS SCENE is the phone call (Priya's voice, her room, her tone). NOT a continuation of where the player was.
- "Walk out" → THIS SCENE is the player on the street / in the parking lot / wherever they walked TO.
- "Pitch Garry" → THIS SCENE is the pitch (Garry's reactions, the snack table he was at, the player's words landing or not).
- "Stay quiet" → THIS SCENE is the silence playing out (the other character filling it, or the room shifting).

CAST CONTRACT (LOAD-BEARING):
- The episode skeleton has a CAST ROSTER (a closed set of named characters). You may use ONLY these names.
- Pick a subset who appear in THIS scene based on the prior choice. Most scenes have 1 named character; some have 2.
- Do NOT invent new named characters. If the player's choice triggers an interaction with someone NOT in the roster, render via narration only ("a barista sets the cup down") — no speaker line for them.
- The "cast" output array on this scene MUST be the subset who actually speak in THIS scene's dialogue.

SETTING CONTRACT:
- You invent the setting fresh per scene. It MUST follow from the prior choice + the episode's theme.
- Setting goes in the "setting" output field (≤280 chars; concrete time + place).
- Examples: "the YC kitchen at 11pm Tuesday, half-eaten sourdough loaf on the island", "Priya's apartment in the Mission, Saturday morning, espresso machine still hissing", "Caltrain southbound, 4:30pm Friday, half-empty car".

EPISODE END (the most important new field):
- You decide when the episode arc closes. Set "isLastSceneOfEpisode": true on the scene where the episode's arc resolves: a choice has been finalized, a scene has paid off, and the player is at a natural transition point.
- The next scene-gen call after a true flag fires the next /api/generate-episode (a new theme, new cast). Set this judiciously — typically after 3–6 scenes per episode.
- Default to false unless the moment genuinely closes the arc.

HARD RULES:
- Output a single JSON object only. No markdown fences. Start with "{" and end with "}".
- Numbers must be valid JSON.
- "role" is the PRIMARY role of THIS scene's main character (one of: vc | cofounder | reporter | hater | mentor). Used for image + voice routing.
- Dialogue speakers: "player", "narrator", or any role key whose CAST name appears in this scene's cast subset.
- Total dialogue ≤${MAX_DIALOGUE_CHARS_PER_SCENE} chars per scene.
- Each line ≤160 chars; non-empty.
- 2–4 dialogue lines.
- JSON STRING SAFETY: inside any "text" field, NEVER use the " character. Use single quotes (') or em-dashes. Bad: "text": "He said \\"sure\\"."  Good: "text": "He said 'sure'."  Every unescaped " breaks the parser.
- Each line is ONE speaker's utterance. Don't merge narration + speech.
- Choice labels: 2–3 per scene, ≤8 words, action-flavored.
- Stat deltas per choice: hype + integrity ∈ {-2, -1, 0, +1, +2}. Most should be ±1; reserve ±2 for genuinely consequential moments.
- imagePrompt ≤220 chars: setting + character action + mood + composition. NEVER style words ("comic", "cel-shaded", "illustration") — the renderer prepends those. Match what's actually happening in the scene's setting.
- timeoutSeconds: integer 8–60.
- DO NOT resolve the run.

ANTI-CLICHÉ OPENERS:
- Don't open with "your phone buzzes/vibrates/lights up", "a Slack ping", "your inbox refreshes", "Twitter mentions explode". These LLM-default openers recur across players.
- Open with a place, an action, or in-progress dialogue.

SHARE MOMENT (OPTIONAL — default OMIT):
- Only when this scene is genuinely brag-worthy (a famous cameo arrived; the player made a contrarian/bold call; |stat| ≥ 4; stat reversal).
- At most one per ~5 scenes. When in doubt, OMIT.

OUTPUT SHAPE:
{
  "id": number,
  "title": string,
  "role": "vc"|"cofounder"|"reporter"|"hater"|"mentor",
  "setting": string (≤280 chars; concrete time + place — invented for THIS scene),
  "cast": [
    { "role": role-key, "name": string (must come from episode cast roster), "blurb"?: string }
  ],
  "isLastSceneOfEpisode": boolean (true → triggers next episode after this scene),
  "imagePrompt": string,
  "dialogue": [{ "speaker": role-key | "player" | "narrator", "text": string }],
  "choices": [{ "id": "a"|"b"|"c", "label": string, "consequence": string, "hype": number, "integrity": number }],
  "timeoutSeconds": number,
  "timeoutChoiceId": "a"|"b"|"c",
  "shareMoment"?: { "title": string, "blurb": string }
}`

function formatRecentChoices(choices: PriorChoiceSummary[]): string {
  if (choices.length === 0) return '(none)'
  return choices
    .map(
      (c) =>
        `Scene ${c.sceneId}: "${c.choiceLabel}" (hype ${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}, integrity ${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta})`,
    )
    .join('\n')
}

function formatLastChoiceCallout(c?: PriorChoiceSummary): string | null {
  if (!c) return null
  const hypeStr = `${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}`
  const integStr = `${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta}`
  return `## PRIOR CHOICE — THE PLAYER ALREADY DID THIS
The player chose: "${c.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr}.

PAST TENSE. This scene is the IMMEDIATE consequence of that choice.
- Choice was "Call Priya" → this scene IS the phone call (Priya speaking, the player listening, the player's room or wherever they took the call).
- Choice was "Walk over to Rin" → this scene IS the moment at Rin's desk (her face, her words, her work).
- Choice was "Walk out" → this scene IS outside (the cold, the silence, the call the player didn't make).
- Choice was a refusal / silence → this scene IS the consequence playing out (the room shifting, the other character moving on).

Do NOT re-litigate the choice or have the player decide again. Render the consequence in motion.`
}

function formatEpisodeCast(ep: Episode): string {
  return ep.cast
    .map((c) => `- ${c.role}: ${c.name}${c.blurb ? ` — ${c.blurb}` : ''}`)
    .join('\n')
}

function formatArcBullets(ep: Episode): string {
  if (!ep.arcBullets || ep.arcBullets.length === 0) return '(none)'
  return ep.arcBullets.map((b) => `- ${b}`).join('\n')
}

export function buildScenePromptParts(input: BuildScenePromptInput) {
  const { episode, sceneIndexInEpisode, totalScenesInEpisodeSoFar } = input

  // Cached block: stable across all scene calls in the same episode.
  const cachedContext = `## ROLE GLOSSARY (voice/personality flavor only — names come from the cast roster below)
${(['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as Role[])
  .map((r) => {
    const def = ROLES[r]
    return `- ${r}: ${def.roleLabel} — ${def.title}. ${def.personality}`
  })
  .join('\n')}

## EPISODE SKELETON (the closed container for ALL scenes in this episode)
Theme: ${episode.theme}
Premise: ${episode.premise}

## EPISODE CAST ROSTER (closed set — you may NOT introduce a named character outside this list)
${formatEpisodeCast(episode)}

## ARC BULLETS (loose hints; NOT scene-by-scene plans — pick from / interpolate between based on prior choice)
${formatArcBullets(episode)}

## STORY SO FAR (compressed, covers everything before this episode)
${input.storySoFar ?? '(this is the opening episode — no prior summary)'}

## PLAYER STATE
Startup: ${input.startupName}
Founder vibe: ${input.founderPersona || '(unstated)'}

## PLAYER FACTS (HONOR THESE — never invent contradictions)
Team: ${input.team || '(unstated; treat as solo)'}
Funding: ${input.fundingModel || '(unstated)'}
Target customer: ${input.targetCustomer || '(unstated)'}
Current concern: ${input.concern || '(unstated)'}`

  const lastChoiceBlock = formatLastChoiceCallout(input.lastChoice)
  const isFirstScene = sceneIndexInEpisode === 0

  const liveBlock = `${input.tone ? `${input.tone.oneLiner}\n\n` : ''}${lastChoiceBlock ? `${lastChoiceBlock}\n\n` : ''}## RECENT CHOICES (last few; for tone — the PRIOR CHOICE block above is the load-bearing one)
${formatRecentChoices(input.recentChoices)}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

## YOUR JOB FOR THIS SCENE
${
  isFirstScene
    ? `OPEN the episode. Invent a setting that fits the episode's theme. Pick a cast subset (1–2 names) from the EPISODE CAST ROSTER. Render a single dialogue exchange + 2–3 choices. End on a hook the next scene will react to.`
    : `CONTINUE the episode. The PRIOR CHOICE above is past-tense action — invent a setting + cast subset that's the IMMEDIATE consequence. Render dialogue + 2–3 choices. Pick people from the cast roster who fit this consequence (the person the player just called, the person who walked in, etc.).`
}

You DECIDE when the episode arc resolves. Set "isLastSceneOfEpisode": true if THIS scene closes the arc (a peak moment, a clean exit). Otherwise false. Typical episodes have 3–6 scenes; this is scene ${sceneIndexInEpisode + 1} of the episode so far.

## THIS SCENE
Episode ${episode.episodeIndex}, scene ${sceneIndexInEpisode} (id=${input.sceneId}). Total scenes-played in this episode: ${totalScenesInEpisodeSoFar}.

Output the JSON object now.`

  return {
    systemBlocks: [
      { text: SCENE_SYSTEM_RULES, cache: false },
      { text: cachedContext, cache: true },
    ],
    userBlocks: [{ text: liveBlock, cache: false }],
  }
}
