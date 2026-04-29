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

CHOICE-RESPONSIVENESS (LOAD-BEARING):
- The PRIOR BEAT CHOICE (when present) is the dominant input.
- "Call Priya" → THIS beat's dialogue IS the call (Priya speaking, on the phone, the player listening).
- "Walk to Rin" → THIS beat IS at Rin's desk (her words, her work).
- "Stay quiet" → THIS beat IS the silence playing out — the other character filling it, the room shifting.
- Do NOT re-litigate the choice. Render the consequence in motion.

OPENING vs CONTINUATION:
- Beat 0 (the scene's opener): establish the setting in motion. Drop the player into the room. End on a choice that the next beat will react to.
- Beat 1+: continue the scene. The setting and cast remain. Pick up where the prior beat ended; render the consequence of the player's choice.

WHEN TO END A SCENE (isLastBeatOfScene):
- Set TRUE on the beat where the scene's arc CLOSES. Typical scenes have 2–4 beats. Some go longer if the conversation has more to give.
- Examples of natural scene-ending moments: a door closes, a phone call ends, a character walks away, the player makes a clean exit, a moment of silence after a crucial line.
- Do NOT set TRUE arbitrarily — the scene should feel finished, not cut short.
- Scene 0 of an episode usually has 2–4 beats. Later scenes may be shorter (1–2 beats) if they're transition moments.

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

function formatPriorBeatChoice(c?: PriorChoiceSummary): string | null {
  if (!c) return null
  const hypeStr = `${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}`
  const integStr = `${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta}`
  return `## PRIOR BEAT CHOICE — THE PLAYER ALREADY DID THIS
The player just chose: "${c.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr}.

PAST TENSE. This beat is the IMMEDIATE consequence. Render the doing or the consequence — not the deciding.`
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

  const lastChoiceBlock = formatPriorBeatChoice(input.priorBeatChoice)
  const isFirstBeat = beatIndex === 0

  const liveBlock = `${input.tone ? `${input.tone.oneLiner}\n\n` : ''}${lastChoiceBlock ? `${lastChoiceBlock}\n\n` : ''}## SCENE PLAN (PRE-FIXED — render dialogue THAT FITS, do not change setting or cast)
${formatScenePlan(plan)}

## PRIOR BEATS DIALOGUE (this scene only; previous beats the player has already played through)
${formatPriorBeatsDialogue(input.priorBeatsDialogue)}

## RECENT CHOICES (cross-scene history; for tone — the PRIOR BEAT CHOICE block above is the load-bearing one)
${formatRecentChoices(input.recentChoices)}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

## YOUR JOB FOR THIS BEAT
${
  isFirstBeat
    ? `OPEN scene ${sceneIndexInEpisode + 1} of the episode. The player just walked into the setting above. Establish the moment in motion (a place, an action, in-progress dialogue). Use ONLY the cast names listed in this scene's cast. End on a choice the next beat will react to.

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
