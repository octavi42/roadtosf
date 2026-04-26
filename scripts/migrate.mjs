#!/usr/bin/env node
// Apply every .sql file in migrations/ in lexicographic order.
// Run with: npm run db:migrate

import { readFileSync, readdirSync } from 'node:fs'
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
const dir = join(here, '..', 'migrations')

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

for (const file of files) {
  const text = readFileSync(join(dir, file), 'utf8')
  const statements = text
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))

  console.log(`▶ ${file} (${statements.length} statements)`)
  for (const stmt of statements) {
    await sql.query(stmt)
  }
  console.log(`✓ ${file}`)
}

console.log('Migrations complete.')
