#!/usr/bin/env node
// Probe the silicon-mania splice: fire N arc-gens with varied tag mixes,
// measure how often a real digest name (people/companies/vcs) lands in the
// arc skeleton beats. Prints per-fixture and per-item hit rates so you can
// tune the splice prompt or the selectFlavorPool bonuses with data.
//
// Usage:
//   node --env-file=.env.local scripts/probe-silicon-mania.mjs           # 8 runs, port 3004
//   N=15 PORT=3004 node --env-file=.env.local scripts/probe-silicon-mania.mjs

import { neon } from '@neondatabase/serverless'

const port = process.env.PORT ?? '3004'
const baseUrl = `http://localhost:${port}`
const N = Number.parseInt(process.env.N ?? '8', 10)

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set — copy from .env.local or run with --env-file')
  process.exit(1)
}
const sql = neon(url)

function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const year = d.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${year}-W${String(weekNo).padStart(2, '0')}`
}

const week = process.env.WEEK ?? isoWeekOf(new Date())

// Fixture pool — diverse personas so the probe doesn't just measure one player.
const FIXTURES = [
  {
    name: 'AI agents / podcast / yc',
    body: {
      startupName: 'Codex',
      startupDescription: 'AI agent platform automating SaaS support workflows',
      founderPersona: 'ex-Google PM, anxious first-timer',
      stage: 'MVP',
      team: 'solo',
      fundingModel: 'bootstrap',
      flavorTags: ['ai', 'agents', 'yc', 'podcast'],
    },
  },
  {
    name: 'hardware / robotics / seed',
    body: {
      startupName: 'Schemata',
      startupDescription: 'Robotics startup making warehouse pickers cheaper',
      founderPersona: 'cynical serial founder, second time at this',
      stage: 'idea',
      team: 'two cofounders',
      fundingModel: 'looking to raise seed',
      flavorTags: ['hardware', 'robotics', 'seed', 'sand-hill'],
    },
  },
  {
    name: 'longevity / biotech',
    body: {
      startupName: 'LivLong',
      startupDescription: 'Longevity supplements with personalized blood-panel feedback',
      founderPersona: 'biohacker, ex-WHOOP',
      stage: 'users',
      team: 'small team',
      fundingModel: 'angel-funded',
      flavorTags: ['longevity', 'biohacking', 'health'],
    },
  },
  {
    name: 'consumer / culture / sf',
    body: {
      startupName: 'Tartine.ai',
      startupDescription: 'Restaurant reservation agent for SF foodies',
      founderPersona: 'late-twenties product designer, very online',
      stage: 'MVP',
      team: 'solo',
      fundingModel: 'bootstrap',
      flavorTags: ['consumer', 'culture', 'sf', 'restaurants'],
    },
  },
  {
    name: 'crypto / defi (probably no overlap)',
    body: {
      startupName: 'OnChainCo',
      startupDescription: 'DeFi lending protocol for institutional whales',
      founderPersona: 'ex-Goldman, in it for the money',
      stage: 'idea',
      team: 'three cofounders',
      fundingModel: 'pre-seed closing',
      flavorTags: ['crypto', 'defi', 'finance'],
    },
  },
  {
    name: 'empty flavor (worst case)',
    body: {
      startupName: 'GenericCo',
      startupDescription: 'A startup',
      founderPersona: 'a founder',
      stage: '',
      team: '',
      fundingModel: '',
      flavorTags: [],
    },
  },
  {
    name: 'agents / automation / ai-house',
    body: {
      startupName: 'SwarmSF',
      startupDescription: 'Multi-agent coding assistant living in your editor',
      founderPersona: 'AI-house dweller, hyperlocal',
      stage: 'MVP',
      team: 'duo',
      fundingModel: 'bootstrap',
      flavorTags: ['ai', 'agents', 'automation', 'tools'],
    },
  },
  {
    name: 'media / podcast / writer',
    body: {
      startupName: 'Substack-killer',
      startupDescription: 'A new newsletter platform for tech writers',
      founderPersona: 'ex-journalist, lives on Twitter',
      stage: 'idea',
      team: 'solo',
      fundingModel: 'bootstrap',
      flavorTags: ['media', 'podcast', 'writing', 'newsletter'],
    },
  },
]

async function loadDigestNames() {
  const rows = await sql`
    SELECT id, headline, people, companies, vcs
    FROM silicon_mania_items
    WHERE week = ${week}
  `
  const allNames = new Set()
  const itemNameMap = new Map() // name -> [item ids it belongs to]
  for (const r of rows) {
    const names = [...(r.people ?? []), ...(r.companies ?? []), ...(r.vcs ?? [])]
    for (const n of names) {
      if (!n || n.length < 3) continue
      allNames.add(n)
      if (!itemNameMap.has(n)) itemNameMap.set(n, [])
      itemNameMap.get(n).push(r.id)
    }
  }
  return { rows, allNames: [...allNames], itemNameMap }
}

function findHits(beatsBlob, allNames) {
  const hay = beatsBlob.toLowerCase()
  const found = new Set()
  for (const n of allNames) {
    if (n.length < 3) continue
    if (hay.includes(n.toLowerCase())) found.add(n)
  }
  return [...found]
}

async function fireOne(fixture) {
  const body = {
    episodeIndex: 0,
    ...fixture.body,
    recentChoices: [],
    currentStats: { hype: 0, integrity: 0 },
  }
  const res = await fetch(`${baseUrl}/api/generate-arc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function main() {
  const { rows, allNames, itemNameMap } = await loadDigestNames()
  console.log(`Week ${week}: ${rows.length} items, ${allNames.length} distinct named entities`)
  if (rows.length === 0) {
    console.error('Empty digest for this week — ingest first via /api/admin/refresh-weekly')
    process.exit(1)
  }

  const fixtures = []
  for (let i = 0; i < N; i++) {
    fixtures.push(FIXTURES[i % FIXTURES.length])
  }

  const perItemHits = new Map() // item id -> count
  let runsWithAnyHit = 0
  let runsWith2PlusHits = 0
  const fixtureStats = new Map() // fixture name -> { runs, hits }

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]
    const stats = fixtureStats.get(f.name) ?? { runs: 0, hits: 0, anyHitRuns: 0, poolSize: 0 }

    let response
    try {
      response = await fireOne(f)
    } catch (e) {
      console.error(`run ${i + 1} (${f.name}) failed:`, e.message)
      continue
    }

    const beatsBlob = (response.skeleton?.scenes ?? []).map((s) => s.beat).join('\n')
    const hits = findHits(beatsBlob, allNames)
    const itemIds = new Set()
    for (const name of hits) {
      for (const id of itemNameMap.get(name) ?? []) {
        itemIds.add(id)
      }
    }
    for (const id of itemIds) {
      perItemHits.set(id, (perItemHits.get(id) ?? 0) + 1)
    }

    if (hits.length > 0) runsWithAnyHit++
    if (hits.length >= 2) runsWith2PlusHits++

    stats.runs++
    stats.hits += hits.length
    if (hits.length > 0) stats.anyHitRuns++
    stats.poolSize = response.siliconManiaPoolSize ?? stats.poolSize
    fixtureStats.set(f.name, stats)

    console.log(
      `[${i + 1}/${fixtures.length}] ${f.name} → pool=${response.siliconManiaPoolSize ?? '?'} hits=${hits.length} ${hits.length ? '(' + hits.join(', ') + ')' : ''}`,
    )
  }

  console.log('\n=== AGGREGATE ===')
  console.log(`runs:                  ${fixtures.length}`)
  console.log(`runs with any hit:     ${runsWithAnyHit}/${fixtures.length} (${Math.round((runsWithAnyHit / fixtures.length) * 100)}%)`)
  console.log(`runs with 2+ hits:     ${runsWith2PlusHits}/${fixtures.length} (${Math.round((runsWith2PlusHits / fixtures.length) * 100)}%)`)

  console.log('\n=== BY FIXTURE ===')
  for (const [name, s] of fixtureStats) {
    console.log(`${name.padEnd(36)} runs=${s.runs} pool=${s.poolSize} anyHit=${s.anyHitRuns}/${s.runs} avgHits=${(s.hits / s.runs).toFixed(2)}`)
  }

  console.log('\n=== TOP DIGEST ITEMS ===')
  const sorted = [...perItemHits.entries()].sort((a, b) => b[1] - a[1])
  for (const [id, count] of sorted.slice(0, 10)) {
    console.log(`${count.toString().padStart(2)} × ${id}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
