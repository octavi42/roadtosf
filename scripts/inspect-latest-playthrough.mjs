#!/usr/bin/env node
// One-off: dump the latest playthrough's cast roster across all episodes.
// Run with: node --env-file=.env.local scripts/inspect-latest-playthrough.mjs

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const sql = neon(url)

const rows = await sql`
  SELECT id, startup_name, flavor_tags, arc_json, created_at
  FROM playthroughs
  ORDER BY created_at DESC
  LIMIT 1
`

if (rows.length === 0) {
  console.log('no playthroughs')
  process.exit(0)
}

const p = rows[0]
console.log(`playthrough: ${p.id}`)
console.log(`startup:     ${p.startup_name}`)
console.log(`flavorTags:  ${JSON.stringify(p.flavor_tags)}`)
console.log(`created:     ${p.created_at}`)

const arc = p.arc_json
if (!arc) {
  console.log('no arc_json yet')
  process.exit(0)
}

console.log(`\nepisodeIndex: ${arc.episodeIndex}`)
console.log(`storySoFar:   ${(arc.storySoFar ?? '').slice(0, 200)}…`)

const ep = arc.currentEpisode
if (ep) {
  console.log(`\n=== current episode ${ep.episodeIndex} ===`)
  console.log(`theme:   ${ep.theme}`)
  console.log(`premise: ${ep.premise}`)
  console.log(`cast (${ep.cast?.length ?? 0}):`)
  for (const c of ep.cast ?? []) {
    console.log(`  - [${c.role}] ${c.name}  (gender=${c.gender ?? '?'} age=${c.age ?? '?'})`)
    if (c.blurb) console.log(`      blurb: ${c.blurb}`)
  }
  console.log(`scenes:`)
  for (const s of ep.scenes ?? []) {
    const cast = (s.cast ?? []).map((c) => c.name).join(', ')
    console.log(`  ${s.index}. "${s.title}" cast=[${cast}]`)
  }
}

// Also dump the full names that ever appeared across arc.scenes (not just
// currentEpisode) so we can see celebrity density across the whole run.
const allNames = new Set()
for (const s of arc.scenes ?? []) {
  for (const c of s.cast ?? []) allNames.add(c.name)
}
console.log(`\nALL named characters across this playthrough:`)
for (const n of [...allNames].sort()) console.log(`  ${n}`)
