// Public entry: selectFlavorPool(flavorTags, k, week) — async because it
// reads the silicon_mania_items table. Pure ranker (rankItems) is exported
// separately so the splicing logic stays unit-testable without a DB.

import { getSql } from '@/lib/db'
import type { SMItem } from './types'
import { currentIsoWeek } from './week'

const CAMEO_BONUS = 0.15
const NAMED_PEOPLE_BONUS = 0.1

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const A = new Set(a.map((t) => t.toLowerCase()))
  const B = new Set(b.map((t) => t.toLowerCase()))
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

export function scoreItem(item: SMItem, flavorTags: string[]): number {
  const base = jaccard(flavorTags, item.tags)
  let bonus = 0
  if (item.category === 'cameo') bonus += CAMEO_BONUS
  if (item.people.length > 0) bonus += NAMED_PEOPLE_BONUS
  return base + bonus
}

// Deterministic tiebreaker: by id, so an empty-flavor playthrough still gets
// a stable pool order across reloads of the same week.
function tieBreak(a: SMItem, b: SMItem): number {
  return a.id.localeCompare(b.id)
}

/**
 * Pure ranker — exported for tests. Score = Jaccard(flavorTags, item.tags)
 * + 0.15 if category==='cameo' + 0.1 if item names anyone.
 */
export function rankItems(pool: SMItem[], flavorTags: string[], k = 4): SMItem[] {
  if (pool.length === 0) return []
  const scored = pool.map((item) => ({ item, score: scoreItem(item, flavorTags) }))
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return tieBreak(a.item, b.item)
  })
  return scored.slice(0, k).map((s) => s.item)
}

interface DbRow {
  week: string
  id: string
  headline: string
  summary: string
  image_url: string | null
  category: string | null
  tags: string[] | null
  people: string[] | null
  companies: string[] | null
  vcs: string[] | null
}

function rowToItem(r: DbRow): SMItem {
  return {
    week: r.week,
    id: r.id,
    headline: r.headline,
    summary: r.summary,
    imageUrl: r.image_url,
    category: r.category,
    tags: r.tags ?? [],
    people: r.people ?? [],
    companies: r.companies ?? [],
    vcs: r.vcs ?? [],
  }
}

/**
 * Read the digest snapshot for a week (defaults to the current ISO week)
 * and rank-select up to k items by overlap with the player's flavorTags.
 * Returns [] if the table has nothing for that week — caller MUST treat
 * empty as "skip the real-news splice and run arc-gen unmodified".
 *
 * Swallows DB errors and returns [] — never block a playthrough.
 */
export async function selectFlavorPool(
  flavorTags: string[],
  k = 4,
  week?: string,
): Promise<SMItem[]> {
  const targetWeek = week ?? currentIsoWeek()
  try {
    const sql = getSql()
    const rows = (await sql`
      SELECT week, id, headline, summary, image_url, category, tags, people, companies, vcs
      FROM silicon_mania_items
      WHERE week = ${targetWeek}
    `) as unknown as DbRow[]
    if (!Array.isArray(rows) || rows.length === 0) return []
    const pool = rows.map(rowToItem)
    return rankItems(pool, flavorTags, k)
  } catch (err) {
    console.warn('[silicon-mania] selectFlavorPool failed; returning []', err)
    return []
  }
}
