import { ROLES } from '../archetypes'
import type { DialogueLine, Episode, Role, ScenePlan } from '../types'
import { MAX_DIALOGUE_CHARS_PER_BEAT } from '../schemas/scene'
import type { ToneSpec } from '../cameos/types'

export interface PriorChoiceSummary {
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildBeatPromptInput {
  /** Episode skeleton (theme, cast roster, scenes[]). */
  episode: Episode
  /** Index of THIS scene within episode.scenes. */
  sceneIndexInEpisode: number
  /** Index of THIS beat within the scene's beat sequence (0 = opening). */
  beatIndex: number
  /** Dialogue accumulated from prior beats of THIS scene (NOT prior
   *  scenes). Empty for beat 0. The LLM uses this to continue the
   *  conversation naturally. */
  priorBeatsDialogue: DialogueLine[]
  /** The choice the player made on the prior beat of THIS scene
   *  (undefined for beat 0). The load-bearing input for in-scene
   *  branching: this beat is a direct consequence of that choice. */
  priorBeatChoice?: PriorChoiceSummary
  /** 1-based id within the playthrough. */
  sceneId: number
  /** Cross-episode rolling memory. */
  storySoFar?: string
  startupName: string
  founderPersona: string
  team?: string
  fundingModel?: string
  targetCustomer?: string
  concern?: string
  /** Cross-scene recent history (across episodes). */
  recentChoices: PriorChoiceSummary[]
  currentStats: { hype: number; integrity: number }
  tone?: ToneSpec
  /** Is this the LAST scene of the current episode? Influences
   *  whether the LLM may set isLastSceneOfEpisode. */
  isFinalSceneOfEpisode: boolean
}

const BEAT_SYSTEM_RULES = `You are the per-BEAT engine for "Road to SF". A SCENE is a container the player stays inside through MULTIPLE BEATS. Each beat = one dialogue exchange + one choice block. Setting, cast, and image stay locked across all beats of the scene; ONLY dialogue and choices change as the player makes choices.

Your job: generate ONE BEAT, given the scene plan + the dialogue from prior beats of this same scene + the player's last choice.

WHAT A BEAT IS:
- 2–4 dialogue lines that continue (or open) the scene's conversation
- 2–3 choices the player picks from to drive the next beat (or close the scene)
- A flag — isLastBeatOfScene — set TRUE when this beat closes the scene's arc, FALSE while there's more to play

CHOICE-RESPONSIVENESS (LOAD-BEARING — the most important rule):
- The PRIOR BEAT CHOICE (when present) is the dominant input.
- The FIRST LINE of this beat MUST literally enact the chosen action. Convert the choice label into the first line of dialogue or narration.

FIRST-LINE PATTERNS (examples — match the shape, don't copy verbatim):
- Choice "Ask her about her funding" → first line: [player] "So, what's your funding situation?"
- Choice "Push back on the equity terms" → first line: [player] "That equity split doesn't work for me."
- Choice "Call Priya" → first line: [narrator] You pick up the phone. Two rings. Then her voice.
- Choice "Walk over to Rin" → first line: [narrator] The chair scrapes. Three steps. You're at her desk.
- Choice "Walk out" → first line: [narrator] The door clicks shut behind you. The street is colder than you thought.
- Choice "Stay quiet" → first line: [narrator] You don't answer. The silence stretches.
- Choice "Tell him the truth" → first line: [player] "Eighteen months. That's it."
- Choice "Take the term sheet" → first line: [narrator] You sign. He slides the contract back across the bar.
- Choice "Sleep on it" → first line: [narrator] You close the laptop. The kitchen is dark now. Tomorrow.

Do NOT open with framing like "You think about whether to call her" or "You're standing at the door deciding." Render the DOING, not the deciding.

The rest of the beat (lines 2–4) is the consequence playing out — the response, the reaction, the room shifting, the next character arriving.

OPENING vs CONTINUATION:
- Beat 0 (the scene's opener): establish the setting in motion. Drop the player into the room. End on a choice that the next beat will react to.
- Beat 1+: continue the scene. The setting and cast remain. Pick up where the prior beat ended; render the consequence of the player's choice.

WHEN TO END A SCENE (isLastBeatOfScene) — KEEP SCENES SHORT:
- Default scene length: 2–3 beats. THREE beats is the typical cap. Do not let scenes drag into 5+ beats.
- Beat 0 (opener): isLastBeatOfScene = false. (Always — the scene just started.)
- Beat 1: isLastBeatOfScene = false unless the scene is a clean one-exchange transition.
- Beat 2: STRONG candidate for isLastBeatOfScene = true. Most scenes close here. Look for any reason to wrap: a clean line, a beat of silence, a decision made, a door closing.
- Beat 3: Default to isLastBeatOfScene = true. By beat 3 the scene has had its full arc. Only continue past 3 if the conversation is genuinely escalating into something new (not just two characters re-litigating the same point).
- Beat 4 is a HARD CAP. The server force-closes the scene at beat 4 regardless of what you set; scenes that reach beat 4 should ALWAYS set isLastBeatOfScene = true.
- Natural scene-ending moments: a door closes, a phone call ends, a character walks away, the player makes a decision, a beat of silence after a crucial line, the player physically leaves the room/building.
- Scenes can also be just 1–2 beats if they're brief transitions (a quick chance encounter, a single decisive moment).
- Bias toward CLOSING the scene rather than keeping it open. The episode has 3–5 scenes total; a scene running 6+ beats means the player loses the rhythm of moving through the episode.

WHEN TO END THE EPISODE (isLastSceneOfEpisode):
- This flag is RESERVED for the LAST scene of the episode (signaled in the prompt below).
- On non-final scenes, ALWAYS set isLastSceneOfEpisode = false.
- On the LAST scene, set TRUE only on the beat that ALSO has isLastBeatOfScene = true (so the very last beat of the very last scene closes both).

CAST CONTRACT:
- Use ONLY the names in this scene's cast subset (listed in the prompt). Don't invent new named characters.
- The episode roster is also available in the prompt for context, but THIS SCENE's cast is the closed set of speakers.
- New people exist via narration only ("a barista glances over") — they don't get speaker lines.

HARD RULES:
- Output a single JSON object only. No markdown fences. Start with "{" and end with "}".
- Numbers must be valid JSON.
- Speakers: "player", "narrator", or any role key in the scene's cast.
- Total beat dialogue ≤${MAX_DIALOGUE_CHARS_PER_BEAT} chars.
- Each line ≤160 chars.
- 2–4 lines per beat.
- JSON STRING SAFETY: NEVER use the " character inside a "text" field. Use single quotes (') or em-dashes. Bad: "text": "He said \\"sure\\"."  Good: "text": "He said 'sure'."  Every unescaped " breaks the parser.
- Each line is ONE speaker's utterance.
- Choice labels: 2–3 per beat, ≤8 words, action-flavored.
- Stat deltas: hype + integrity ∈ {-2, -1, 0, +1, +2}. Most should be ±1; reserve ±2 for genuinely consequential choices (typically the scene's last beat).
- timeoutSeconds: integer 8–60.
- DO NOT resolve the run.

ANTI-CLICHÉ:
- Don't open with "your phone buzzes/vibrates", "a Slack ping", "your inbox refreshes". Open with action, place, or in-progress dialogue.

OUTPUT SHAPE:
{
  "dialogue": [{ "speaker": role-key | "player" | "narrator", "text": string }],
  "choices": [{ "id": "a"|"b"|"c", "label": string, "consequence": string, "hype": number, "integrity": number }],
  "timeoutSeconds": number,
  "timeoutChoiceId": "a"|"b"|"c",
  "isLastBeatOfScene": boolean,
  "isLastSceneOfEpisode": boolean (false on non-final scenes; true ONLY on the final scene's final beat),
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

function formatPriorBeatChoice(
  c?: PriorChoiceSummary,
  opts: { isCrossSceneOpen?: boolean } = {},
): string | null {
  if (!c) return null
  const hypeStr = `${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}`
  const integStr = `${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta}`

  // Cross-scene boundary: the prior choice happened in the previous
  // scene with a different cast. Putting the player's choice-words
  // back in their mouth at the new cast member produces nonsense
  // (e.g. "Ask him to grab coffee tomorrow" said to Theo in scene 10
  // was being re-spoken to Simone at the open of scene 11). Land the
  // player in the new setting and let the prior choice color tone,
  // not become opening dialogue.
  if (opts.isCrossSceneOpen) {
    return `## PRIOR BEAT CHOICE — CONTEXT FROM THE PREVIOUS SCENE (do NOT put these words in this scene's mouth)
The player just chose: "${c.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr} (use this for tone, not for opening dialogue).

This choice was directed at a character in the PREVIOUS scene. That character is no longer present. The player has since moved — physically, in time, or both — into the setting + cast for THIS scene.

Do NOT open this beat by having the player re-speak the choice to whoever is in front of them now. That collapses two scenes into one and lands the words on the wrong person.

Open this beat by landing the player in this scene's setting — narrator framing of how they got here, what time has passed, the new cast member's first impression — then let the new cast drive the dialogue. The prior choice may color the player's mood or carry stakes into this scene; it does not become an opening line.

If the prior choice names a roster member who IS in this scene, defer to the PIVOT AUTHORITY block above instead.`
  }

  return `## PRIOR BEAT CHOICE — THE PLAYER ALREADY DID THIS (LOAD-BEARING)
The player just chose: "${c.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr}.

The FIRST LINE of this beat MUST literally enact the choice "${c.choiceLabel}":
- If the choice is a question / statement (e.g. "Ask her about X", "Tell him Y", "Push back on Z") → the first line is the player saying that thing in their own words: [player] "..."
- If the choice is an action (e.g. "Call X", "Walk out", "Sign the contract") → the first line is the narrator describing the player doing it: [narrator] "..."
- If the choice is a refusal / silence (e.g. "Stay quiet", "Don't answer") → the first line is the narrator describing the silence playing out.

Do NOT open with framing like "You think about it" or "You're deciding." The choice is past tense. Render it happening.

The rest of the beat is the OTHER person's reaction (or, in solo beats, the consequence playing out).`
}

function formatPriorBeatsDialogue(lines: DialogueLine[]): string {
  if (lines.length === 0) return '(this is the opening beat — no prior dialogue in this scene yet)'
  return lines.map((l) => `[${l.speaker}] ${l.text}`).join('\n')
}

function formatScenePlan(plan: ScenePlan): string {
  const cast = plan.cast
    .map((c) => `- ${c.role}: ${c.name}${c.blurb ? ` — ${c.blurb}` : ''}`)
    .join('\n')
  return `Index: ${plan.index}
Title: ${plan.title}
Setting: ${plan.setting}
Topic: ${plan.topic}
Image (already committed): ${plan.imagePrompt}
Cast for this scene (closed set — these are the only allowed named speakers):
${cast}`
}

function formatEpisodeRoster(ep: Episode): string {
  return ep.cast
    .map((c) => `- ${c.role}: ${c.name}${c.blurb ? ` — ${c.blurb}` : ''}`)
    .join('\n')
}

export function buildBeatPromptParts(input: BuildBeatPromptInput) {
  const { episode, sceneIndexInEpisode, beatIndex } = input
  const plan = episode.scenes[sceneIndexInEpisode]
  if (!plan) {
    throw new Error(
      `No ScenePlan at index ${sceneIndexInEpisode} of episode ${episode.episodeIndex}`,
    )
  }
  const role = ROLES[plan.role]
  const isPivotPoint = beatIndex === 0 && sceneIndexInEpisode > 0

  const cachedContext = `## ROLE GLOSSARY (voice/personality flavor only — names come from the cast)
${(['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as Role[])
  .map((r) => {
    const def = ROLES[r]
    return `- ${r}: ${def.roleLabel} — ${def.title}. ${def.personality}`
  })
  .join('\n')}

## EPISODE
Theme: ${episode.theme}
Premise: ${episode.premise}

## EPISODE CAST ROSTER (full set — for context)
${formatEpisodeRoster(episode)}

## STORY SO FAR (compressed, prior episodes)
${input.storySoFar ?? '(this is the opening episode — no prior summary)'}

## PLAYER STATE
Startup: ${input.startupName}
Founder vibe: ${input.founderPersona || '(unstated)'}

## PLAYER FACTS (HONOR THESE)
Team: ${input.team || '(unstated; treat as solo)'}
Funding: ${input.fundingModel || '(unstated)'}
Target customer: ${input.targetCustomer || '(unstated)'}
Current concern: ${input.concern || '(unstated)'}

## ROLE INFO FOR THIS SCENE'S PRIMARY ROLE
${plan.role}: ${role.roleLabel} — ${role.title}. ${role.personality}`

  const isFirstBeat = beatIndex === 0
  // A cross-scene cold-open is the first beat of any new scene
  // container that has a priorBeatChoice (i.e. the choice came from
  // the previous scene's last beat, not from a sibling beat in this
  // scene). The literal-enactment rule does not apply here.
  const lastChoiceBlock = formatPriorBeatChoice(input.priorBeatChoice, {
    isCrossSceneOpen: isFirstBeat,
  })

  // Detect if the prior choice mentions a roster member by name. If
  // so, the pivot is FORCED — that character must be the speaker of
  // this scene, regardless of the planned cast.
  const priorChoiceText = (input.priorBeatChoice?.choiceLabel ?? '').toLowerCase()
  const namedInChoice = priorChoiceText
    ? episode.cast.find((c) =>
        priorChoiceText.includes(c.name.toLowerCase().split(' ')[0]!),
      )
    : undefined

  const pivotBlock = isPivotPoint
    ? `## PIVOT AUTHORITY — READ BEFORE RENDERING
The episode planner committed to this scene's setting + cast BEFORE the player played the prior scene. Read the PRIOR BEAT CHOICE above carefully. It's the player's last action from the PRIOR SCENE, not from this scene.

${
  namedInChoice
    ? `### HARD PIVOT REQUIRED (a roster member is named in the prior choice)
The prior choice contains "${namedInChoice.name}" — a member of the EPISODE ROSTER. The player's choice was: "${input.priorBeatChoice?.choiceLabel}".

This means the player is now interacting with ${namedInChoice.name} — NOT the planned cast. You MUST pivot:
- Output the pivot fields EXACTLY in this shape (note "cast" is an ARRAY OF OBJECTS — not an array of strings, not an object map):
  "role": "${namedInChoice.role}",
  "cast": [
    { "role": "${namedInChoice.role}", "name": "${namedInChoice.name}", "blurb": ${JSON.stringify(namedInChoice.blurb ?? '')} }
  ],
  "setting": (invent a setting that fits how the player reached ${namedInChoice.name} — a phone call from the player's car, ${namedInChoice.name}'s apartment, a meeting they pulled together on the way),
  "title": (reflect the new scene — e.g. "On the phone with ${namedInChoice.name}", "${namedInChoice.name}'s apartment"),
- The first dialogue line is ${priorChoiceText.startsWith('call') ? `the call connecting ([narrator] You hit dial. Two rings. Then ${namedInChoice.name} picks up.)` : `the player arriving / ${namedInChoice.name} opening the door / etc.`}
- The second dialogue line is ${namedInChoice.name} speaking with speaker="${namedInChoice.role}"

DO NOT emit cast as ["${namedInChoice.role}"] (array of strings — wrong).
DO NOT emit cast as {"${namedInChoice.role}": "${namedInChoice.name}"} (object map — wrong).
DO emit cast as [{ "role": "${namedInChoice.role}", "name": "${namedInChoice.name}" }] (array of objects — correct).

Do NOT render the planned scene. Do NOT use the planned cast.

`
    : ''
}You have THREE options (use them when no roster member is named in the prior choice):
A) Render the planned scene as-is (setting + cast above). USE THIS when the planned scene still fits naturally with where the player ended up — e.g. they took a meeting, walked toward the planned cast member, didn't reject them.
B) Render the planned scene's SETTING but with a DIFFERENT cast member from the EPISODE ROSTER below. USE THIS when the planned cast member is no longer narratively present.
C) PIVOT FULLY — invent a NEW setting + pick a different cast member from the EPISODE ROSTER. USE THIS when the planned scene is incoherent given the prior choice.

Whichever you pick, output your CHOSEN setting + cast in the JSON. Stay inside the EPISODE THEME ("${episode.theme}") — the pivot keeps the narrative line, just shifts which beat is in front of the player.

Episode roster (the closed set you may pick cast from when pivoting; do NOT invent new named characters outside this list):
${episode.cast.map((c) => `- ${c.role}: ${c.name}${c.blurb ? ` — ${c.blurb}` : ''}`).join('\n')}

The "role" output field should reflect the role of the cast member you pick. The "title" field can stay close to the planned title or shift to fit your pivot.

`
    : ''

  const liveBlock = `${input.tone ? `${input.tone.oneLiner}\n\n` : ''}${lastChoiceBlock ? `${lastChoiceBlock}\n\n` : ''}${pivotBlock}## SCENE PLAN (${isPivotPoint ? 'STRONG DEFAULT — see PIVOT AUTHORITY above' : 'PRE-FIXED — render dialogue that fits, do not change setting or cast'})
${formatScenePlan(plan)}

## PRIOR BEATS DIALOGUE (this scene only; previous beats the player has already played through)
${formatPriorBeatsDialogue(input.priorBeatsDialogue)}

## RECENT CHOICES (cross-scene history; for tone — the PRIOR BEAT CHOICE block above is the load-bearing one)
${formatRecentChoices(input.recentChoices)}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

## YOUR JOB FOR THIS BEAT
${
  isFirstBeat
    ? `OPEN scene ${sceneIndexInEpisode + 1} of the episode. ${isPivotPoint ? 'Use the PIVOT AUTHORITY above to decide whether to render the planned scene or pivot.' : 'Establish the moment in motion (a place, an action, in-progress dialogue). Use ONLY the cast names listed in this scene\'s cast.'} End on a choice the next beat will react to.

This is the FIRST beat of this scene; isLastBeatOfScene is almost certainly false unless this is a single-beat transition scene.`
    : `CONTINUE scene ${sceneIndexInEpisode + 1}. The PRIOR BEAT CHOICE above is past-tense action. Render the consequence in dialogue. Stay in the scene's setting (the cast may shift among the listed names — e.g. someone leaves and another enters from the cast list). End on a choice OR close the scene.

This is beat ${beatIndex + 1} of the scene. Set isLastBeatOfScene = true if the scene's arc CLOSES on this beat — a clean exit, a phone call ends, a door closes, a quiet beat after a crucial line.`
}

EPISODE-END FLAG:
- This scene is ${input.isFinalSceneOfEpisode ? 'the FINAL scene of the episode' : 'NOT the final scene of the episode'}.
- ${input.isFinalSceneOfEpisode ? 'You MAY set isLastSceneOfEpisode = true on the beat that also closes this scene (i.e. when isLastBeatOfScene = true).' : 'You MUST set isLastSceneOfEpisode = false on this beat.'}

## THIS BEAT
Episode ${episode.episodeIndex}, scene ${sceneIndexInEpisode}, beat ${beatIndex} (sceneId=${input.sceneId}).

Output the JSON object now.`

  return {
    systemBlocks: [
      { text: BEAT_SYSTEM_RULES, cache: false },
      { text: cachedContext, cache: true },
    ],
    userBlocks: [{ text: liveBlock, cache: false }],
  }
}

// Back-compat: the old name is still imported by the route. Keep an
// alias so the rewrite doesn't ripple.
export const buildScenePromptParts = buildBeatPromptParts
export type BuildScenePromptInput = BuildBeatPromptInput
