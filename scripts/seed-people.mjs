#!/usr/bin/env node
// Upsert src/lib/lore/people-seed.json into the sf_people table.
//
// Source-of-truth is the JSON file in repo. The DB row is a cache.
// PR-edit the JSON, run `npm run seed:people`, done.
//
// Run with: npm run seed:people  (after wiring in package.json)
// Or directly: node --env-file=.env.local scripts/seed-people.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set. Add it to .env.local — see .env.example.')
  process.exit(1)
}

const sql = neon(url)
const here = dirname(fileURLToPath(import.meta.url))
const seedPath = join(here, '..', 'src', 'lib', 'lore', 'people-seed.json')

const raw = readFileSync(seedPath, 'utf8')
let people
try {
  people = JSON.parse(raw)
} catch (err) {
  console.error('Failed to parse people-seed.json:', err)
  process.exit(1)
}

if (!Array.isArray(people)) {
  console.error('people-seed.json is not an array')
  process.exit(1)
}

const VALID_ROLES = new Set(['vc', 'cofounder', 'reporter', 'hater', 'mentor'])

let inserted = 0
let updated = 0
let skipped = 0

for (const p of people) {
  if (!p || typeof p !== 'object') {
    skipped++
    continue
  }
  if (typeof p.id !== 'string' || p.id.length === 0) {
    console.warn('skipping row with missing id:', p)
    skipped++
    continue
  }
  if (!VALID_ROLES.has(p.role)) {
    console.warn(`skipping ${p.id}: invalid role ${JSON.stringify(p.role)}`)
    skipped++
    continue
  }

  const before = await sql`SELECT 1 FROM sf_people WHERE id = ${p.id}`
  const isNew = before.length === 0

  await sql`
    INSERT INTO sf_people (
      id, display_name, role, vibe, regular_spots, x_handle,
      encounter_styles, tags, achievement_hook, updated_at
    ) VALUES (
      ${p.id},
      ${p.display_name ?? ''},
      ${p.role},
      ${p.vibe ?? ''},
      ${Array.isArray(p.regular_spots) ? p.regular_spots : []},
      ${p.x_handle ?? null},
      ${Array.isArray(p.encounter_styles) ? p.encounter_styles : []},
      ${Array.isArray(p.tags) ? p.tags : []},
      ${p.achievement_hook ?? null},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      display_name     = EXCLUDED.display_name,
      role             = EXCLUDED.role,
      vibe             = EXCLUDED.vibe,
      regular_spots    = EXCLUDED.regular_spots,
      x_handle         = EXCLUDED.x_handle,
      encounter_styles = EXCLUDED.encounter_styles,
      tags             = EXCLUDED.tags,
      achievement_hook = EXCLUDED.achievement_hook,
      updated_at       = NOW()
  `

  if (isNew) inserted++
  else updated++
}

console.log(
  `sf_people upserted: ${inserted} inserted, ${updated} updated, ${skipped} skipped (total ${people.length})`,
)
