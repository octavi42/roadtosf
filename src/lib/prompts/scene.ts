import { ROLES } from '../archetypes'
import type { Episode, ScenePlan } from '../types'
import { MAX_DIALOGUE_CHARS_PER_SCENE } from '../schemas/scene'
import type { ToneSpec } from '../cameos/types'

export interface PriorChoiceSummary {
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildScenePromptInput {
  /** Currently-playing episode. Provides theme + cross-scene context. */
  episode: Episode
  /** Index of THIS scene within episode.scenes (0..episode.scenes.length-1). */
  sceneIndexInEpisode: number
  /** Round within this scene (0..roundCount-1). One round = one dialogue
   *  exchange + one choice block. Setting + cast + imagePrompt stay
   *  fixed across all rounds; only dialogue + choices vary. */
  roundIndex: number
  /** Total rounds in this scene. Final round = (roundIndex === roundCount-1). */
  roundCount: number
  /** The choice the player made in the prior round of THIS scene (if
   *  any). Drives the within-scene branching: round N+1's dialogue
   *  reacts directly to the choice from round N. Distinct from
   *  recentChoices, which spans the whole run. */
  priorRoundChoice?: PriorChoiceSummary
  /** 1-based id within the full playthrough. */
  sceneId: number
  /** Compressed memory across all prior episodes. */
  storySoFar?: string
  startupName: string
  founderPersona: string
  team?: string
  fundingModel?: string
  targetCustomer?: string
  concern?: string
  /** Recent player choices across the run — used so dialogue can
   *  acknowledge cross-scene/episode history. */
  recentChoices: PriorChoiceSummary[]
  currentStats: { hype: number; integrity: number }
  tone?: ToneSpec
}

const SCENE_SYSTEM_RULES = `You are the per-round dialogue engine for "Road to SF". You receive a PRE-PLANNED scene (setting, cast, imagePrompt all fixed by the episode planner) and render ONE ROUND inside it: a single dialogue exchange + one choice block.

A scene is multiple rounds (typically 2-4). Each round, the player makes a choice. The NEXT round's dialogue must react to that choice — either the next exchange unfolds in the same setting (the conversation continues), or a different cast member from the scene's roster takes over (e.g. the player chose to call them).

HARD RULES:
- Output a single JSON object only. No prose before or after, no markdown fences. Start with "{" and end with "}".
- Numbers must be valid JSON (1 not +1).
- "role" MUST be the scene's primary role (vc | cofounder | reporter | hater | mentor).
- Dialogue speakers MUST be one of: "player", "narrator", or any role key whose CAST name appears in this scene's cast list. Multi-role scenes are allowed: if the cast lists cofounder + hater, both may speak.
- Total dialogue across all lines ≤${MAX_DIALOGUE_CHARS_PER_SCENE} chars per round.
- Each individual line ≤160 chars; non-empty text only.
- 2–4 dialogue lines per round.
- JSON STRING SAFETY (the most-broken rule, do not relax): inside any "text" field, NEVER use the " character. Use single quotes (') or em-dashes for in-text speech. Bad: "text": "He said \\"sure\\"."  Good: "text": "He said 'sure'."  Every unescaped " breaks the parser.
- Choice labels: 2–3 per round, ≤8 words, action-flavored.
- timeoutSeconds: integer 8–60.
- imagePrompt: copy verbatim from the plan — the renderer reuses one image per scene across all rounds. Do not invent a new image.
- DO NOT resolve the run.

CAST CONTRACT (LOAD-BEARING):
- Use cast names verbatim. The cast roster is the FULL set of people who can speak in this scene — primary character + anyone the player could call + anyone who could walk in.
- Do NOT introduce a new named character outside the cast roster. New people exist via narration only ("a barista glances over") — they do not get a "speaker" line.
- If the prior round's choice was something like "Call Priya" and Priya is in the cast, Priya speaks in THIS round. If Priya is NOT in the cast, the call goes to voicemail / no answer / similar — render the consequence, do not invent her voice.

SETTING CONTRACT:
- The plan committed to a SETTING. All rounds of this scene happen in or around it. Within-scene branches CAN shift the immediate frame (a phone call from a parking lot, walking outside, retreating to a corner) but the scene's anchor location stays.
- The episode has a THEME. Stay inside it.

ROUND POSITION & STAT DELTAS:
- Mid-round (NOT the final round of the scene): hype + integrity ∈ {-1, 0, +1}. These are micro-decisions that flavor the scene; they do not carry the scene's full punch.
- Final round (the LAST round of the scene): hype + integrity ∈ {-2, -1, 0, +1, +2}. The scene's main consequences land here.
- Whether a round is mid or final is signaled in the prompt below — honor it strictly.

PRIOR-ROUND CHOICE CONTRACT (LOAD-BEARING):
- When a PRIOR-ROUND CHOICE block appears below, treat it as PAST-TENSE ACTION. The player already did it. Render the doing or the immediate consequence — not the deciding.
- Bad: "The player walks toward the door, considering whether to leave." Good: "The door clicks shut behind you. The street is louder than you remembered."

ANTI-CLICHÉ OPENERS:
- DO NOT open with "your phone buzzes/vibrates", "a Slack ping", "an inbox refresh", "Twitter mentions explode". These are LLM-default openers that recur across players.
- Open with a place, an action, or in-progress dialogue — let the round enter the situation already in motion.

SHARE MOMENT (OPTIONAL FIELD — default OMIT):
- Only on the FINAL round of a scene, and only when this scene is genuinely brag-worthy (a famous cameo arrived; the player made a bold call; |stat| ≥ 4; stat reversal).
- Frequency budget: at most one per ~5 scenes. When in doubt, OMIT.

OUTPUT SHAPE:
{
  "id": number,
  "title": string,
  "role": "vc"|"cofounder"|"reporter"|"hater"|"mentor",
  "imagePrompt": string,
  "dialogue": [{ "speaker": role-key | "player" | "narrator", "text": string }],
  "choices": [{ "id": "a"|"b"|"c", "label": string, "consequence": string, "hype": number, "integrity": number }],
  "timeoutSeconds": number,
  "timeoutChoiceId": "a"|"b"|"c",
  "shareMoment"?: { "title": string, "blurb": string }   // OPTIONAL — final round only
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

function formatPriorRoundChoice(c?: PriorChoiceSummary): string | null {
  if (!c) return null
  const hypeStr = `${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}`
  const integStr = `${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta}`
  return `## PRIOR ROUND CHOICE — THIS SCENE'S PREVIOUS ROUND
The player just chose: "${c.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr}.

PAST TENSE. Render this round as the IMMEDIATE consequence of that choice.
- If the choice was "call X" and X is in the cast → X is now on the phone with the player THIS ROUND.
- If the choice was a deflection / silence / retreat → the other character reacts to that silence THIS ROUND.
- If the choice was an interruption / outburst → render the room's reaction THIS ROUND.

Do NOT re-litigate the choice. It happened. Show what's happening NOW.`
}

function formatCast(plan: ScenePlan): string {
  return plan.cast
    .map((c) => `- ${c.role}: ${c.name}${c.blurb ? ` — ${c.blurb}` : ''}`)
    .join('\n')
}

export function buildScenePromptParts(input: BuildScenePromptInput) {
  const { episode, sceneIndexInEpisode, roundIndex, roundCount } = input
  const plan = episode.scenes[sceneIndexInEpisode]
  if (!plan) {
    throw new Error(
      `No ScenePlan at index ${sceneIndexInEpisode} of episode ${episode.episodeIndex}`,
    )
  }
  const role = ROLES[plan.role]
  const isFinalRound = roundIndex === roundCount - 1
  const isFirstRound = roundIndex === 0

  const cachedContext = `## ROLE GLOSSARY (voice/personality flavor only — names come from the cast)
- ${plan.role}: ${role.roleLabel} — ${role.title}. ${role.personality}

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

  const priorRoundBlock = formatPriorRoundChoice(input.priorRoundChoice)

  const liveBlock = `${input.tone ? `${input.tone.oneLiner}\n\n` : ''}${priorRoundBlock ? `${priorRoundBlock}\n\n` : ''}## EPISODE
Theme: ${episode.theme}
Premise: ${episode.premise}
Scene ${sceneIndexInEpisode + 1} of ${episode.scenes.length}.

## SCENE PLAN (PRE-FIXED — render dialogue THAT FITS, do not change setting or cast)
Setting: ${plan.setting}
Beat: ${plan.beat}
${plan.kind ? `Kind: ${plan.kind}` : ''}

## CAST ROSTER (the FULL set of people who can speak in this scene)
${formatCast(plan)}

The roster lists EVERYONE who might appear: the primary character, anyone the player could call, anyone who could walk in. Use these names verbatim. Do NOT introduce a new named character outside this list.

## IMAGE PROMPT (already committed; copy verbatim — one image is reused for all rounds of this scene)
${plan.imagePrompt}

## ROUND
Round ${roundIndex + 1} of ${roundCount}. ${isFinalRound ? 'THIS IS THE FINAL ROUND OF THIS SCENE.' : 'Mid-scene round (not the final).'}

Stat delta range for THIS round:
- ${isFinalRound ? 'FULL: hype + integrity ∈ {-2, -1, 0, +1, +2}.' : 'DAMPENED: hype + integrity ∈ {-1, 0, +1} only. Save the big swings for the final round.'}

## RECENT CHOICES (across the whole run; for tone/context only — the PRIOR-ROUND block above is the load-bearing one)
${formatRecentChoices(input.recentChoices)}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

## YOUR JOB FOR THIS ROUND
${
  isFirstRound
    ? 'OPEN the scene. Establish setting + active cast in motion. End on a choice that round 2 will literally enact.'
    : `CONTINUE the scene. The PRIOR ROUND CHOICE above is past-tense action — render the immediate consequence in dialogue. ${
        isFinalRound
          ? 'This is the FINAL round of the scene; the choices here drive the next scene\'s opening (or end the episode if this is the last scene).'
          : 'Land on a choice that the NEXT round of THIS scene will react to.'
      }`
}

Generate the dialogue + choices fresh from the plan + prior round choice. The imagePrompt is already committed — copy it verbatim. No prewritten lines.

## THIS ROUND
Episode ${episode.episodeIndex}, scene ${sceneIndexInEpisode}, round ${roundIndex} (id=${input.sceneId}).

Output the JSON object now.`

  return {
    systemBlocks: [
      { text: SCENE_SYSTEM_RULES, cache: false },
      { text: cachedContext, cache: true },
    ],
    userBlocks: [{ text: liveBlock, cache: false }],
  }
}
