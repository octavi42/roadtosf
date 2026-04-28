import { ARCHETYPES } from '../archetypes'
import type { ArcSkeleton, SceneOutline } from '../types'
import { MAX_DIALOGUE_CHARS_PER_SCENE } from '../schemas/scene'
import type { ToneSpec } from '../cameos/types'

export interface PriorChoiceSummary {
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildScenePromptInput {
  episodeIndex: number
  llmIndexInEpisode: number // 0..EPISODE_LENGTH-1 (= 0..19), position within episode
  /** Which archetype group within the episode (0..GROUPS_PER_EPISODE-1). */
  groupIndex: number
  /** Position within the archetype group (0..SCENES_PER_GROUP-1). 0 opens. */
  subSceneIndex: number
  sceneId: number // 1-based id within the full playthrough
  outline: SceneOutline
  arcSkeleton: ArcSkeleton
  storySoFar?: string // rolling compressed summary across all prior episodes
  startupName: string
  startupDescription: string
  founderPersona: string
  stage?: string
  team?: string
  fundingModel?: string
  targetCustomer?: string
  concern?: string
  flavorTags: string[]
  recentChoices: PriorChoiceSummary[] // only the last few; older context lives in storySoFar
  currentStats: { hype: number; integrity: number }
  /** Per-run tone (rolled at run-start, stable across all scenes). */
  tone?: ToneSpec
}

const SCENE_SYSTEM_RULES = `You are the per-scene engine for "Road to SF", a satirical comic-book founder game running in ENDLESS MODE. You produce ONE scene at a time, given the current episode's arc skeleton, a rolling story-so-far summary, and the player's recent choices.

HARD RULES:
- Output a single JSON object only. No prose before or after, no markdown fences. Start your response with "{" and end with "}".
- Numbers must be valid JSON: write 1 not +1, write 2 not +2.
- Real people are NEVER named — archetype them.
- Use ONLY the archetype assigned in the outline as the in-scene speaker (other archetypes can be referenced in dialogue but not present).
- In JSON, "archetype" and NPC dialogue "speaker" MUST be the lowercase archetype KEY (vc|cofounder|reporter|hater|mentor) or player|narrator — NEVER a display string like "Stranger, Co-founder & CTO" or "Victor, Managing Partner…".
- Total dialogue across all lines in this scene MUST be ≤${MAX_DIALOGUE_CHARS_PER_SCENE} chars (TTS budget).
- Each individual dialogue line ≤160 chars and MUST contain non-empty text. Do not use empty strings for "silent beats" — express silence in narration prose, not as an empty player line.
- 2–4 dialogue lines per scene total.
- Choice labels: 2–3 per scene, ≤8 words each, action-flavored.
- Stat deltas: hype and integrity each ∈ {-2, -1, 0, +1, +2}. Most should be ±1.
- timeoutSeconds: integer from 8 to 60 only (not seconds-per-line totals).
- choice "consequence": optional, ≤160 characters each if present.
- imagePrompt: ≤220 chars. Setting + character action + mood + composition. NEVER style words (no "comic", "cel-shaded", "illustration") — the renderer prepends those.
- DO NOT resolve the run in dialogue. The player chooses when to end. Each scene leaves a hook.

SHARE MOMENT (OPTIONAL FIELD — default is to OMIT):
- The player just made a choice. If — and only if — that choice (or this scene's beat) is genuinely brag-worthy, you MAY include a "shareMoment" object.
- Trigger criteria (need at least one): a famous archetype just appeared (Thiel-coded VC, Sam-coded mentor, etc.); the player made a contrarian/bold call against the obvious option; a stat just crossed |hype| ≥ 4 or |integrity| ≥ 4; a stat reversed sign (e.g. went from +2 to -1).
- Frequency budget: aim for at most one shareMoment per 5 scenes. When in doubt, OMIT.
- title: ≤8 words, present-tense, punchy ("You walked from $5M."). Speaks to the player as "you".
- blurb: 1–2 sentences, ≤180 chars, MUST name a specific in-fiction detail (the cameo archetype, a place, a dollar figure, the founder's startupName). Generic copy is forbidden — no "you made a bold move", no "what a moment".
- If you cannot satisfy the specificity rule, omit shareMoment entirely.

ABSOLUTE PROHIBITIONS (override the outline if they conflict):
- The cofounder speaker has no fixed first name from the roster ("Stranger" is a label only). Use a name only if "Team" facts name someone, verbatim.
- If the player's Team says "solo" / "no cofounder": do NOT speak as if a cofounder is already in the player's life. The cofounder archetype, if assigned, is a stranger trying to attach themselves OR a memory/ghost — never a current partner.
- If the player named a cofounder (e.g. "my cofounder Anna"), use that name verbatim. Never substitute a different name.
- If Funding says "bootstrapping": do NOT reference term sheets the player has, equity advisory clauses, or VC drama in motion. VC scenes are cold solicitations, not active deals.

CAST LIST LOCK (anti-retroactive-worldbuilding + anti-cliché — see Hidden Door + Drama Llama findings in STORYLETS.md):
- The ONLY named characters you may reference are: (a) the player's startup, (b) the player's cofounder if "Team" names one, (c) REAL PUBLIC FIGURES already named in the scene's beat (Peter Thiel, Sam Altman, Paul Graham, Garry Tan, Marc Andreessen, etc. — these came from the cameo engine and are intentional).
- Do NOT invent new named NPCs ("Jessica from Sequoia", "Arman the technical lead", etc.). Strangers stay strangers.
- ANTI-CLICHÉ NAME SCRUB: If the input beat contains a generic first name that is NOT a real public figure (e.g. "Victor", "Sandra", "Chad", "Sarah", "Mike", "Marcus" — typical LLM defaults), TREAT IT AS A PLACEHOLDER ONLY. In your rendered scene, refer to that NPC by their archetype role ("the partner", "the reporter", "the mentor") — never by the placeholder name. The same default names recurring across players is exactly the bug we're scrubbing.
- The speaker for THIS scene is the assigned archetype — do not introduce a second named character into the dialogue.

OUTPUT SHAPE:
{
  "id": number,
  "title": string,
  "archetype": "vc"|"cofounder"|"reporter"|"hater"|"mentor" (exactly; same as THIS SCENE in outline),
  "imagePrompt": string,
  "dialogue": [{ "speaker": same archetype key OR "player" OR "narrator", "text": string }],
  "choices": [{ "id": "a"|"b"|"c", "label": string, "consequence": string, "hype": number, "integrity": number }],
  "timeoutSeconds": number,
  "timeoutChoiceId": "a"|"b"|"c",
  "shareMoment"?: { "title": string, "blurb": string }   // OPTIONAL — see SHARE MOMENT rules; usually omit
}`

function formatArcSummary(arc: ArcSkeleton): string {
  const lines: string[] = []
  lines.push(`Episode ${arc.episodeIndex} premise: ${arc.premise}`)
  lines.push('Group outlines (each group = 4 sub-scenes with the same archetype, same location):')
  // Skip placeholder outlines from a streaming-partial skeleton (see
  // makePartialArcSkeleton in page.tsx). The first scene-gen of each
  // episode is fired before the full arc finishes streaming; only the
  // current (real) outline is shown to keep cross-group context honest.
  arc.scenes.forEach((s) => {
    if (s.beat === '__pending') return
    lines.push(`  group ${s.index}: ${s.archetype} — ${s.beat}${s.hingesOn ? ` (hinges on: ${s.hingesOn})` : ''}`)
  })
  return lines.join('\n')
}

function formatRecentChoices(choices: PriorChoiceSummary[]): string {
  if (choices.length === 0) return '(none)'
  return choices
    .map(
      (c) =>
        `Scene ${c.sceneId}: "${c.choiceLabel}" (hype ${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}, integrity ${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta})`,
    )
    .join('\n')
}

// Choice-illusion fix: surface the single most-recent choice and its
// stat delta in its OWN block at the top of the live prompt, separate
// from the bulk recent-choices history. The dialogue must acknowledge
// this choice's effect — without this hoist, the renderer tends to
// produce prose that floats free of what the player actually picked.
// See STORYLETS.md (Hidden Door findings).
function formatPriorChoiceCallout(
  choices: PriorChoiceSummary[],
): string | null {
  if (choices.length === 0) return null
  const last = choices[choices.length - 1]!
  const hypeStr = `${last.hypeDelta >= 0 ? '+' : ''}${last.hypeDelta}`
  const integStr = `${last.integrityDelta >= 0 ? '+' : ''}${last.integrityDelta}`
  return `## PRIOR CHOICE (acknowledge this — its effect must show in dialogue/body language)
Player just chose: "${last.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr}.
The opening line(s) of THIS scene must visibly react to that choice (a callback, a tone shift, a side-effect in the world, an NPC reading it back). Do not write generic dialogue that would land for any branch.`
}

export function buildScenePromptParts(input: BuildScenePromptInput) {
  const arche = ARCHETYPES[input.outline.archetype]
  const arcSummary = formatArcSummary(input.arcSkeleton)

  // Cached block: stable across all scene calls in the same episode.
  // Replaces the prior "dump all history" approach with a compressed summary.
  const cachedContext = `## CHARACTER (this scene's speaker)
JSON keys — use EXACTLY for "archetype" and for NPC dialogue "speaker": ${input.outline.archetype}
Role card (voice flavor only; never paste this label into JSON): ${arche.name}, ${arche.title}.
Personality: ${arche.personality}
${
  input.outline.archetype === 'cofounder'
    ? '\nNote: "Stranger" is UI flavor only — not a spoken name. If Team facts say solo, they must not claim to be an existing cofounder unless Team names someone.'
    : ''
}

## CURRENT EPISODE SKELETON
${arcSummary}

## STORY SO FAR (compressed, covers everything before this episode)
${input.storySoFar ?? '(this is the opening episode — no prior summary)'}

## PLAYER STATE
Startup: ${input.startupName}
Pitch: ${input.startupDescription || '(unstated)'}
Founder vibe: ${input.founderPersona || '(unstated)'}
Stage: ${input.stage || '(unstated)'}

## PLAYER FACTS (HONOR THESE — never invent contradictions)
Team: ${input.team || '(unstated; do not invent a cofounder, treat as solo)'}
Funding: ${input.fundingModel || '(unstated; do not assume a fundraising track)'}
Target customer: ${input.targetCustomer || '(unstated; keep generic — don\'t invent a wrong segment)'}
Current concern: ${input.concern || '(unstated)'}`

  // Per-call (uncached): the recent choices + scene target.
  //
  // Each archetype encounter is rendered as 4 sub-scenes that share one
  // location and one image. Sub-scene 0 opens the encounter; 1–3 progress
  // the same conversation, reacting to the player's prior choice. The
  // imagePrompt for sub 1–3 must describe the SAME setting as sub 0 —
  // the renderer reuses sub 0's image regardless, but consistency in the
  // narrated setting matters for the dialogue.
  // The 4 sub-scenes of a group are generated in parallel (one batch per
  // group). That means sub-scenes 1-3 do NOT have direct knowledge of which
  // choice the player made in the prior sub. Write the conversation as a
  // pre-scripted 4-beat scene that escalates regardless of branch. Any prior
  // choice that happens to be in recentChoices can be used lightly, but
  // never gate the dialogue on it — every line must land for any branch.
  const subSceneBlock =
    input.subSceneIndex === 0
      ? `## SUB-SCENE 0 of 4 (opens the encounter)
This is the first beat of a 4-beat encounter with ${arche.name}.
Establish the setting and the character's entrance. End on a choice that
sets up the next exchange. The location you choose will anchor the next
3 sub-scenes — pick a place the conversation can plausibly continue.`
      : `## SUB-SCENE ${input.subSceneIndex} of 4 (continues a 4-beat encounter)
You are writing beat ${input.subSceneIndex + 1} of 4 in the SAME scene with
${arche.name}, at the SAME location established in sub-scene 0. Same
character, same scene, same imagePrompt setting.
This sub-scene is generated IN PARALLEL with the others — you do not see
the player's prior choices in this group. Write a continuation that:
  - works for ANY branch of the prior sub-scene's choices
  - keeps the conversation moving forward, never restarting
  - escalates the encounter narratively (tension / stakes / revelation)
  - does NOT name a specific prior choice or quote it back
${
  input.subSceneIndex === 3
    ? 'This is sub-scene 3 — the final beat. Close the encounter cleanly so the next archetype can enter; leave a hook, do NOT resolve the run.'
    : ''
}`

  const priorChoiceBlock = formatPriorChoiceCallout(input.recentChoices)

  const liveBlock = `${input.tone ? `${input.tone.oneLiner}\n\n` : ''}${priorChoiceBlock ? `${priorChoiceBlock}\n\n` : ''}## RECENT CHOICES (last few only)
${formatRecentChoices(input.recentChoices)}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

${subSceneBlock}

## THIS SCENE
Episode ${input.episodeIndex}, group ${input.groupIndex} sub ${input.subSceneIndex} (id=${input.sceneId})
Beat to render: ${input.outline.beat}
${input.outline.hingesOn ? `Should hinge on: ${input.outline.hingesOn}` : ''}

Output the JSON object for this scene now.`

  return {
    systemBlocks: [
      { text: SCENE_SYSTEM_RULES, cache: false },
      { text: cachedContext, cache: true },
    ],
    userBlocks: [{ text: liveBlock, cache: false }],
  }
}
