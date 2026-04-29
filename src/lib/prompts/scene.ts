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
  /** Recent player choices — used so dialogue can acknowledge them. */
  recentChoices: PriorChoiceSummary[]
  currentStats: { hype: number; integrity: number }
  tone?: ToneSpec
}

const SCENE_SYSTEM_RULES = `You are the per-scene engine for "Road to SF", a satirical comic-book founder game running in ENDLESS MODE.

You receive a PRE-PLANNED scene from the episode planner (setting, cast, beat, imagePrompt all fixed). Your job is ONLY to render dialogue + choices. Do NOT invent a new setting; do NOT introduce new named characters. Do NOT change cast names — copy them verbatim from the cast list.

HARD RULES:
- Output a single JSON object only. No prose before or after, no markdown fences. Start with "{" and end with "}".
- Numbers must be valid JSON (1 not +1).
- The "role" field MUST be the scene's primary role from the plan (one of: vc | cofounder | reporter | hater | mentor).
- Dialogue speakers MUST be one of: "player", "narrator", or one of the role keys present in the scene's cast (vc | cofounder | reporter | hater | mentor). Multi-role scenes are allowed — if the cast lists cofounder + competitor (hater), both may speak.
- Total dialogue across all lines ≤${MAX_DIALOGUE_CHARS_PER_SCENE} chars.
- Each individual line ≤160 chars; non-empty text only. Express silence in narration prose, not empty player lines.
- 2–4 dialogue lines per scene.
- JSON STRING SAFETY (the most-broken rule, do not relax): inside any "text" field, NEVER use the " character. Use single quotes (') or em-dashes for in-text speech. Bad: "text": "He said \\"sure\\"."  Good: "text": "He said 'sure'."  Every unescaped " breaks the parser.
- Each line is ONE speaker's utterance. Do NOT mix narration + quoted speech in a single "text". Split into separate dialogue entries with different speakers.
- Choice labels: 2–3 per scene, ≤8 words, action-flavored.
- Stat deltas: hype + integrity each ∈ {-2,-1,0,+1,+2}. Most should be ±1.
- timeoutSeconds: integer 8–60.
- choice "consequence": optional, ≤160 chars.
- imagePrompt: ≤220 chars. The plan already has one — copy it verbatim or sharpen with the moment's specific action. NEVER style words ("comic", "cel-shaded", "illustration") — the renderer prepends those.
- DO NOT resolve the run. The player ends it. Each scene leaves a hook.

CAST CONTRACT:
- Use cast names verbatim from the plan. If the plan lists "Maya" as the cofounder candidate, refer to her as Maya. If it lists "Peter Thiel" as the partner, use that name.
- Do NOT introduce a new named character mid-scene. New people enter via narration only ("a partner emeritus glances over from the corner couch") — they do not get a "speaker" line unless the cast already names them.
- Multi-role scenes: any role present in the cast may speak. Strategic — pick which roles serve the moment best. A 3-role cast doesn't mean all 3 speak in every scene.

SETTING CONTRACT:
- The plan committed to a SETTING. Render dialogue THAT TAKES PLACE THERE. Do not invent a new location.
- The episode has a THEME. Stay inside it. If the episode is a hackathon weekend, this scene is at the hackathon (or a moment that's clearly part of it).

PRIOR CHOICE CONTRACT (load-bearing for choice-responsiveness):
- If a PRIOR CHOICE block appears below, treat it as PAST-TENSE ACTION. The player already did it. Render the doing or the immediate consequence — not the deciding.
- Bad: "The player walks toward the door, considering whether to leave." Good: "The door clicks shut behind you. The street is louder than you remembered."

ANTI-CLICHÉ OPENERS (the "phone buzzes" scrub):
- DO NOT open with "your phone buzzes/vibrates/lights up", "a Slack ping", "an inbox refresh", "Twitter mentions explode", or any "device interrupts" framing. These are LLM-default openers that recur across every player.
- Open with a place ("Sightglass at 4pm; the espresso line snakes out the door"), an action ("you push your laptop away and walk to the window"), or in-progress dialogue ("'so the gap year was YC,' she says, mid-sentence").

SHARE MOMENT (OPTIONAL FIELD — default is to OMIT):
- Only include "shareMoment" if this scene is genuinely brag-worthy (a famous cameo arrived; the player made a contrarian/bold call; a stat reversal; |stat| ≥ 4).
- Frequency budget: at most one per ~5 scenes. When in doubt, OMIT.
- title: ≤8 words, present-tense, punchy. Speaks to the player as "you".
- blurb: 1–2 sentences, ≤180 chars, must name a specific in-fiction detail.

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

function formatPriorChoiceCallout(
  choices: PriorChoiceSummary[],
): string | null {
  if (choices.length === 0) return null
  const last = choices[choices.length - 1]!
  const hypeStr = `${last.hypeDelta >= 0 ? '+' : ''}${last.hypeDelta}`
  const integStr = `${last.integrityDelta >= 0 ? '+' : ''}${last.integrityDelta}`
  return `## PRIOR CHOICE — THE PLAYER ALREADY DID THIS
The player chose: "${last.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr}.

PAST TENSE. The action has happened. Render the doing or the consequence — not the decision.`
}

function formatCast(plan: ScenePlan): string {
  return plan.cast
    .map((c) => `- ${c.role}: ${c.name}${c.blurb ? ` — ${c.blurb}` : ''}`)
    .join('\n')
}

export function buildScenePromptParts(input: BuildScenePromptInput) {
  const { episode, sceneIndexInEpisode } = input
  const plan = episode.scenes[sceneIndexInEpisode]
  if (!plan) {
    throw new Error(
      `No ScenePlan at index ${sceneIndexInEpisode} of episode ${episode.episodeIndex}`,
    )
  }
  const role = ROLES[plan.role]

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

  const priorChoiceBlock = formatPriorChoiceCallout(input.recentChoices)
  const isFirstScene = sceneIndexInEpisode === 0

  const liveBlock = `${input.tone ? `${input.tone.oneLiner}\n\n` : ''}${priorChoiceBlock ? `${priorChoiceBlock}\n\n` : ''}## EPISODE
Theme: ${episode.theme}
Premise: ${episode.premise}
Scene ${sceneIndexInEpisode + 1} of ${episode.scenes.length}.

## SCENE PLAN (PRE-FIXED — render dialogue THAT FITS, do not change setting or cast)
Setting: ${plan.setting}
Beat: ${plan.beat}
${plan.kind ? `Kind: ${plan.kind}` : ''}

## CAST (use these names verbatim; multi-role scenes allow any of these to speak)
${formatCast(plan)}

## IMAGE PROMPT (already committed; copy verbatim or sharpen for the moment)
${plan.imagePrompt}

## RECENT CHOICES (last few only)
${formatRecentChoices(input.recentChoices)}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

## YOUR JOB FOR THIS SCENE
${
  isFirstScene
    ? 'OPEN the episode. Establish the setting + active cast in motion. End on choices that the next scene will literally enact.'
    : 'CONTINUE the episode. Honor the prior choice (above) as past-tense action. Stay in the episode\'s setting unless the prior choice explicitly took the player elsewhere. End on choices that drive the next scene.'
}

Generate the dialogue, choices, and (if needed) a sharpened imagePrompt fresh from the plan + prior choice. No prewritten lines.

## THIS SCENE
Episode ${episode.episodeIndex}, scene ${sceneIndexInEpisode} (id=${input.sceneId}).

Output the JSON object now.`

  return {
    systemBlocks: [
      { text: SCENE_SYSTEM_RULES, cache: false },
      { text: cachedContext, cache: true },
    ],
    userBlocks: [{ text: liveBlock, cache: false }],
  }
}
