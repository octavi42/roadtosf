import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = neon(url)

const playthroughs = await sql`
  SELECT id, anon_id, startup_name, startup_description, self_description,
         flavor_tags, intro_transcript, arc_json, ending, epilogue,
         achievements, created_at, completed_at
  FROM playthroughs
  ORDER BY created_at DESC
  LIMIT 1
`

if (playthroughs.length === 0) {
  console.log('No playthroughs found.')
  process.exit(0)
}

const p = playthroughs[0]

console.log('━'.repeat(80))
console.log('PLAYTHROUGH', p.id)
console.log('━'.repeat(80))
console.log('Created:    ', p.created_at)
console.log('Completed:  ', p.completed_at ?? '(in progress)')
console.log('Startup:    ', p.startup_name)
console.log('Pitch:      ', p.startup_description)
console.log('Self desc:  ', p.self_description)
console.log('Flavor tags:', JSON.stringify(p.flavor_tags))
console.log('Ending:     ', p.ending)
console.log()
if (p.epilogue) {
  console.log('--- EPILOGUE ---')
  console.log(p.epilogue)
  console.log()
}

const events = await sql`
  SELECT scene_number, dialogue, choices_shown, choice_picked, free_text,
         was_timeout, time_to_choose_ms, stat_deltas, created_at
  FROM scene_events
  WHERE playthrough_id = ${p.id}
  ORDER BY created_at ASC
`

console.log(`--- SCENE EVENTS (${events.length}) ---`)
for (const e of events) {
  const deltas = e.stat_deltas ?? {}
  console.log()
  console.log(`Scene ${e.scene_number}  •  pick: ${e.choice_picked}  •  h${deltas.hype >= 0 ? '+' : ''}${deltas.hype ?? 0}/i${deltas.integrity >= 0 ? '+' : ''}${deltas.integrity ?? 0}  •  ${e.time_to_choose_ms ?? '?'}ms`)
  if (e.dialogue) {
    const lines = String(e.dialogue).split('\n').slice(0, 6)
    for (const l of lines) console.log('  ' + l)
  }
  if (Array.isArray(e.choices_shown) && e.choices_shown.length > 0) {
    console.log('  choices: ' + e.choices_shown.map((c) => `${c.id}:${c.label}`).join(' | '))
  }
  if (e.free_text) {
    console.log('  text:', e.free_text)
  }
  if (e.was_timeout) console.log('  TIMED OUT')
}

if (p.arc_json) {
  console.log()
  console.log('--- ARC JSON (skeleton + scenes) ---')
  console.log(JSON.stringify(p.arc_json, null, 2))
}
