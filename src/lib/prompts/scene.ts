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
  llmIndex: number // 0-indexed within the LLM tail (0..LLM_SCENE_COUNT-1)
  sceneId: number // 1-based id within the full playthrough
  outline: SceneOutline
  arcSkeleton: ArcSkeleton
  startupName: string
  startupDescription: string
  founderPersona: string
  stage?: string
  flavorTags: string[]
  priorChoices: PriorChoiceSummary[]
  currentStats: { hype: number; integrity: number }
}

const SCENE_SYSTEM_RULES = `You are the per-scene engine for "Road to SF", a satirical comic-book founder game. You produce ONE scene at a time, given an arc skeleton and the player's choices so far.

HARD RULES:
- Output a single JSON object. No prose, no fences. The user message starts your reply with "{".
- Real people are NEVER named — archetype them.
- Use ONLY the archetype assigned in the outline as the in-scene speaker (other archetypes can be referenced in dialogue but not present).
- Total dialogue across all lines in this scene MUST be ≤${MAX_DIALOGUE_CHARS_PER_SCENE} chars (TTS budget).
- Each individual dialogue line ≤160 chars. 2–4 lines per scene total.
- Choice labels: 2–3 per scene, ≤8 words each, action-flavored.
- Stat deltas: hype and integrity each ∈ {-2, -1, 0, +1, +2}. Most should be ±1.
- imagePrompt: ≤220 chars. Setting + character action + mood + composition. NEVER style words (no "comic", "cel-shaded", "illustration") — the renderer prepends those.

OUTPUT SHAPE:
{
  "id": number,
  "title": string,
  "archetype": "<assigned archetype>",
  "imagePrompt": string,
  "dialogue": [{ "speaker": "<archetype>"|"player"|"narrator", "text": string }],
  "choices": [{ "id": "a"|"b"|"c", "label": string, "consequence": string, "hype": number, "integrity": number }],
  "timeoutSeconds": number,
  "timeoutChoiceId": "a"|"b"|"c"
}`

function formatArcSummary(arc: ArcSkeleton): string {
  const lines: string[] = []
  lines.push(`Premise: ${arc.premise}`)
  lines.push('Outline:')
  arc.scenes.forEach((s) => {
    lines.push(`  ${s.index}: ${s.archetype} — ${s.beat}${s.hingesOn ? ` (hinges on: ${s.hingesOn})` : ''}`)
  })
  return lines.join('\n')
}

function formatPriorChoices(choices: PriorChoiceSummary[]): string {
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

  // Cached blocks (stable across the 5 per-scene calls in this playthrough):
  // - system rules
  // - arc skeleton + character roster
  const cachedRoster = `## CHARACTER (this scene's speaker)
${input.outline.archetype}: ${arche.name}, ${arche.title}.
Personality: ${arche.personality}

## ARC SKELETON
${arcSummary}

## PLAYER STATE
Startup: ${input.startupName}
Pitch: ${input.startupDescription || '(unstated)'}
Founder vibe: ${input.founderPersona || '(unstated)'}
Stage: ${input.stage || '(unstated)'}`

  // Per-call (uncached): the live choice history + scene target
  const liveBlock = `## PRIOR CHOICES (so far)
${formatPriorChoices(input.priorChoices)}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

## THIS SCENE
LLM tail index: ${input.llmIndex} (id=${input.sceneId})
Beat to render: ${input.outline.beat}
${input.outline.hingesOn ? `Should hinge on: ${input.outline.hingesOn}` : ''}

Produce the JSON object for this scene now. Begin with "{".`

  return {
    systemBlocks: [
      { text: SCENE_SYSTEM_RULES, cache: false },
      { text: cachedRoster, cache: true },
    ],
    userBlocks: [{ text: liveBlock, cache: false }],
  }
}
