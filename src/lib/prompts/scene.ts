import { ARCHETYPES } from '../archetypes'
import type { ArcSkeleton, SceneOutline } from '../types'
import { MAX_DIALOGUE_CHARS_PER_SCENE } from '../schemas/scene'

export interface PriorChoiceSummary {
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildScenePromptInput {
  episodeIndex: number
  llmIndexInEpisode: number // 0..EPISODE_LENGTH-1, position within current episode
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

ABSOLUTE PROHIBITIONS (override the outline if they conflict):
- The cofounder speaker has no fixed first name from the roster ("Stranger" is a label only). Use a name only if "Team" facts name someone, verbatim.
- If the player's Team says "solo" / "no cofounder": do NOT speak as if a cofounder is already in the player's life. The cofounder archetype, if assigned, is a stranger trying to attach themselves OR a memory/ghost — never a current partner.
- If the player named a cofounder (e.g. "my cofounder Anna"), use that name verbatim. Never substitute a different name.
- If Funding says "bootstrapping": do NOT reference term sheets the player has, equity advisory clauses, or VC drama in motion. VC scenes are cold solicitations, not active deals.

OUTPUT SHAPE:
{
  "id": number,
  "title": string,
  "archetype": "vc"|"cofounder"|"reporter"|"hater"|"mentor" (exactly; same as THIS SCENE in outline),
  "imagePrompt": string,
  "dialogue": [{ "speaker": same archetype key OR "player" OR "narrator", "text": string }],
  "choices": [{ "id": "a"|"b"|"c", "label": string, "consequence": string, "hype": number, "integrity": number }],
  "timeoutSeconds": number,
  "timeoutChoiceId": "a"|"b"|"c"
}`

function formatArcSummary(arc: ArcSkeleton): string {
  const lines: string[] = []
  lines.push(`Episode ${arc.episodeIndex} premise: ${arc.premise}`)
  lines.push('Outline:')
  arc.scenes.forEach((s) => {
    lines.push(`  ${s.index}: ${s.archetype} — ${s.beat}${s.hingesOn ? ` (hinges on: ${s.hingesOn})` : ''}`)
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
  const liveBlock = `## RECENT CHOICES (last few only)
${formatRecentChoices(input.recentChoices)}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

## THIS SCENE
Episode ${input.episodeIndex}, scene ${input.llmIndexInEpisode} of episode (id=${input.sceneId})
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
