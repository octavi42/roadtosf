import { NextResponse } from 'next/server'
import { selectNextStorylet } from '@/lib/storylets/select'
import templatesData from '@/lib/storylets/templates.json'
import type {
  FundingCondition,
  SelectionState,
  Storylet,
  StoryletState,
  TeamCondition,
} from '@/lib/storylets/types'
import type { Archetype } from '@/lib/types'

const TEMPLATES = templatesData as unknown as Storylet[]
const TEMPLATE_BY_ID = new Map(TEMPLATES.map((s) => [s.id, s]))

// Choice-responsive storylet re-selection. Called from the client at
// every group boundary (after the player's choice in the prior group's
// last sub-scene). Pure selector call — no LLM, no credits, no DB.
// Sub-millisecond response. The whole architectural point: scenes
// don't have to be pre-picked at episode start; the next group's
// storylet can be chosen based on what just happened.

type Body = {
  episodeIndex?: unknown
  currentStats?: unknown
  team?: unknown
  fundingModel?: unknown
  flavorTags?: unknown
  rolledCameos?: unknown
  tone?: unknown
  seed?: unknown
  storyletState?: unknown
  /** Already-picked storylet IDs this episode. Used to prevent
   *  duplicates and (after archetype lookup) preserve archetype-
   *  diversity within an episode. The route looks up each id in
   *  templates.json so the client doesn't have to track archetypes
   *  separately. Unknown ids are silently dropped. */
  alreadyPickedIds?: unknown
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function asStoryletState(v: unknown): StoryletState {
  if (!v || typeof v !== 'object') return { fired: [], flags: {} }
  const o = v as Record<string, unknown>
  const fired = Array.isArray(o.fired)
    ? o.fired.flatMap((entry): { id: string; firedAtEpisode: number }[] => {
        if (!entry || typeof entry !== 'object') return []
        const e = entry as Record<string, unknown>
        if (typeof e.id !== 'string') return []
        const ep = typeof e.firedAtEpisode === 'number' ? e.firedAtEpisode : 0
        return [{ id: e.id, firedAtEpisode: ep }]
      })
    : []
  const flags: Record<string, boolean> = {}
  if (o.flags && typeof o.flags === 'object') {
    for (const [k, val] of Object.entries(o.flags as Record<string, unknown>)) {
      if (typeof val === 'boolean') flags[k] = val
    }
  }
  return { fired, flags }
}

function asAlreadyPickedFromIds(
  v: unknown,
): { id: string; archetype: Archetype }[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): { id: string; archetype: Archetype }[] => {
    if (typeof item !== 'string') return []
    const tmpl = TEMPLATE_BY_ID.get(item)
    if (!tmpl) return [] // unknown id → skip silently
    return [{ id: item, archetype: tmpl.archetype }]
  })
}

function asRolledCameoIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): string[] => {
    if (typeof item === 'string') return [item]
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      if (typeof o.id === 'string') return [o.id]
    }
    return []
  })
}

// Same heuristic the arc-gen route uses — keep classification logic
// in lockstep so the selector sees identical inputs whether it's
// called at episode start or mid-episode.
function classifyTeam(team?: string): TeamCondition | undefined {
  if (!team) return undefined
  const t = team.toLowerCase()
  if (/(solo|alone|just me|by myself|no co.?founder)/.test(t)) return 'solo'
  return 'named'
}

function classifyFunding(funding?: string): FundingCondition | undefined {
  if (!funding) return undefined
  const f = funding.toLowerCase()
  if (/(bootstrap|no raise|profitable|self.?funded)/.test(f)) return 'bootstrapping'
  if (/(rais|seed|series|preseed|fund)/.test(f)) return 'raising'
  return 'unstated'
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const episodeIndex = asInt(body.episodeIndex, 0)
  const currentHype = asInt(
    (body.currentStats as Record<string, unknown> | undefined)?.hype,
    0,
  )
  const currentIntegrity = asInt(
    (body.currentStats as Record<string, unknown> | undefined)?.integrity,
    0,
  )
  const teamRaw = asString(body.team, '') || undefined
  const fundingRaw = asString(body.fundingModel, '') || undefined
  const rolledCameoIds = asRolledCameoIds(body.rolledCameos)

  const state: SelectionState = {
    episodeIndex,
    hype: currentHype,
    integrity: currentIntegrity,
    team: classifyTeam(teamRaw),
    funding: classifyFunding(fundingRaw),
    storyletState: asStoryletState(body.storyletState),
    rolledCameos: rolledCameoIds.length > 0 ? rolledCameoIds : undefined,
    tone: asString(body.tone, '') || undefined,
    flavorTags: asStringArray(body.flavorTags),
    seed: asString(body.seed, '') || undefined,
  }

  const result = selectNextStorylet(state, {
    alreadyPicked: asAlreadyPickedFromIds(body.alreadyPickedIds),
  })

  if (!result.storylet) {
    return NextResponse.json(
      { error: 'no eligible storylet (every template was filtered or already picked)' },
      { status: 500 },
    )
  }

  // Build a SceneOutline directly from the storylet template — no LLM
  // round-trip on this path. Scene-gen (Haiku) downstream will weave
  // in player-specific texture (startup name, persona) when rendering
  // dialogue, so beats stay personalized at the dialogue layer even
  // though the beat string itself is the raw template.
  return NextResponse.json({
    outline: {
      // Index is set by the caller (which group is being replaced).
      // We don't know it here; the client owns scene-position bookkeeping.
      archetype: result.storylet.archetype,
      beat: result.storylet.beat,
      kind: result.storylet.kind ?? 'encounter',
      summary: result.storylet.summary,
    },
    storyletId: result.storylet.id,
    storyletState: result.finalState,
  })
}
