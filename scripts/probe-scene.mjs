// Hits /api/generate-scene with a realistic payload and reads the SSE stream.
// Logs server-side errors hit the dev server console (see /tmp/dev-server.log).
//
// Usage:
//   PORT=3009 node scripts/probe-scene.mjs           # sub 0
//   PORT=3009 SUB=1 node scripts/probe-scene.mjs     # sub 1 (with prior choice)

const SUB = Number(process.env.SUB ?? 0)
const port = process.env.PORT ?? '3001'
const url = `http://localhost:${port}/api/generate-scene`

const arcSkeleton = {
  episodeIndex: 0,
  premise:
    'A solo founder bootstrapping a city-guide AI agent over their first 24 hours in SF',
  scenes: [
    {
      index: 0,
      archetype: 'reporter',
      beat:
        'A TechCrunch reporter slides into your DMs at the Mission cafe with a screenshot from a stranger and asks for comment.',
      summary: 'Reporter at a cafe with a screenshot, wants comment in 30 minutes.',
      kind: 'encounter',
    },
    {
      index: 1,
      archetype: 'vc',
      beat: 'A Sand Hill partner offers $3M for 15% over a contrarian dinner.',
      summary: 'VC offers term sheet at Sand Hill bar.',
      kind: 'encounter',
    },
    {
      index: 2,
      archetype: 'hater',
      beat: 'A competing CEO sub-tweets you and the dunk goes viral by lunch.',
      summary: 'Twitter dunk from a competing CEO.',
      kind: 'encounter',
    },
    {
      index: 3,
      archetype: 'cofounder',
      beat: 'Your kitchen, 7am. The cold-brew is half-drunk and an old YC batchmate has emailed about cofounding.',
      summary: 'Solo at the kitchen counter re-reading a cofounder email.',
      kind: 'solo',
    },
    {
      index: 4,
      archetype: 'mentor',
      beat: 'Paul Graham emails a four-line response with a link to one of his old essays.',
      summary: 'PG essay-link reply, gnomic, exactly the wrong (right) thing.',
      kind: 'encounter',
    },
  ],
}

const body = {
  llmIndex: SUB,
  llmIndexInEpisode: SUB,
  episodeIndex: 0,
  arcSkeleton,
  storySoFar: '',
  startupName: 'wagr',
  startupDescription: 'a city-guide AI agent for tourists',
  founderPersona: 'anxious first-time founder',
  stage: 'pre-launch',
  team: 'solo, no cofounder',
  fundingModel: 'bootstrapping',
  flavorTags: [],
  recentChoices:
    SUB === 0
      ? []
      : [
          {
            sceneId: 8 + SUB,
            choiceLabel: 'Trade for a better angle.',
            hypeDelta: 1,
            integrityDelta: -1,
          },
        ],
  currentStats: { hype: 0, integrity: 0 },
  playthroughId: 'probe-scene',
}

console.log('POST', url, 'sub', SUB)
// Reuse the cookie jar set by `curl -c /tmp/probe-cookies.txt` against
// /api/dev/grant-credits so the probe identity has credits to debit.
const fs = await import('node:fs')
let cookieHeader
try {
  const jar = fs.readFileSync('/tmp/probe-cookies.txt', 'utf8')
  const anon = jar
    .split('\n')
    .find((l) => l.includes('rsf_anon'))
    ?.split('\t')
    .pop()
  if (anon) cookieHeader = `rsf_anon=${anon}`
} catch {}
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
  },
  body: JSON.stringify(body),
})
console.log('status', res.status, res.statusText)
console.log('content-type', res.headers.get('content-type'))

if (!res.body) {
  console.log('no body')
  process.exit(1)
}

const decoder = new TextDecoder()
const reader = res.body.getReader()
let buf = ''
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  let idx
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const event = buf.slice(0, idx)
    buf = buf.slice(idx + 2)
    const lines = event.split('\n')
    const eventName = lines.find((l) => l.startsWith('event: '))?.slice(7) ?? '?'
    const dataStr = lines.find((l) => l.startsWith('data: '))?.slice(6) ?? ''
    if (eventName === 'done' || eventName === 'error') {
      try {
        const parsed = JSON.parse(dataStr)
        console.log(`\n=== ${eventName} ===`)
        if (parsed.scene) {
          console.log('source:', parsed.source)
          console.log('archetype:', parsed.scene.archetype)
          console.log('title:', parsed.scene.title)
          console.log('imagePrompt:', parsed.scene.imagePrompt?.slice(0, 80))
          console.log('dialogue:')
          for (const d of parsed.scene.dialogue ?? []) {
            console.log(`  [${d.speaker}] ${d.text}`)
          }
          console.log(
            'choices:',
            parsed.scene.choices?.map((c) => `${c.id}:${c.label}`).join(' | '),
          )
        } else {
          console.log(JSON.stringify(parsed, null, 2))
        }
      } catch {
        console.log(`${eventName}:`, dataStr)
      }
    } else {
      console.log(`[${eventName}]`, dataStr.slice(0, 120))
    }
  }
}
