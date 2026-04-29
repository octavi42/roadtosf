// Hits /api/generate-scene with a realistic Episode SKELETON (no
// per-scene plans) and reads the SSE stream. Scene-gen now invents
// setting + cast subset + dialogue + choices + imagePrompt fresh
// per call, reading the skeleton + lastChoice.
//
// Usage:
//   PORT=3000 node scripts/probe-scene.mjs                              # scene 0 of episode 0
//   PORT=3000 SCENE=2 LAST="Call Priya" node scripts/probe-scene.mjs    # scene 2 with prior choice

const SCENE = Number(process.env.SCENE ?? 0)
const LAST = process.env.LAST ?? null
const port = process.env.PORT ?? '3001'
const url = `http://localhost:${port}/api/generate-scene`

const episode = {
  episodeIndex: 0,
  theme: 'First night in SF — the YC co-working space at 11pm',
  premise:
    'You crash the YC space your first night. The room is mostly empty but three people are still here, each wanting something different from you.',
  cast: [
    {
      role: 'cofounder',
      name: 'Maya',
      blurb:
        'Ex-Stripe engineer, three coffees deep, has a deck about you on her laptop she made on the BART ride over. Wants to be your cofounder.',
    },
    {
      role: 'hater',
      name: 'Brandon',
      blurb:
        'CEO of a competing startup with $4M and a year head start. Knows your name. Likes the espresso machine. Will ask about your runway.',
    },
    {
      role: 'mentor',
      name: 'Linda',
      blurb:
        'Partner emeritus at YC. Has watched 200 startups fail. Closes her book and asks if you have eaten.',
    },
  ],
  arcBullets: [
    'the player might get cornered at the kitchen island by a stranger pitching themselves as cofounder',
    'a competitor CEO might appear at the espresso machine and probe for weaknesses',
    'an older mentor figure could close her book and offer one terse piece of advice',
    'the player might choose to leave the building entirely — Folsom Street, late, alone with the deck',
    'an unexpected text could land mid-arc and pull the player away',
  ],
  seedIds: [],
  startLLMIndex: 0,
}

const body = {
  episode,
  episodeIndex: 0,
  sceneIndexInEpisode: SCENE,
  totalScenesInEpisodeSoFar: SCENE + 1,
  lastChoice: LAST
    ? {
        sceneId: 8 + SCENE,
        choiceLabel: LAST,
        hypeDelta: 0,
        integrityDelta: 1,
      }
    : undefined,
  storySoFar: '',
  startupName: 'wagr',
  startupDescription: 'a city-guide AI agent for tourists',
  founderPersona: 'anxious first-time founder',
  team: 'solo, no cofounder',
  fundingModel: 'bootstrapping',
  recentChoices: [],
  currentStats: { hype: 0, integrity: 0 },
  playthroughId: 'probe-scene',
}

console.log('POST', url, 'scene', SCENE, LAST ? `last="${LAST}"` : '(no lastChoice)')
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
          console.log('role:', parsed.scene.role)
          console.log('title:', parsed.scene.title)
          console.log('setting:', parsed.scene.setting)
          console.log('isLastSceneOfEpisode:', parsed.scene.isLastSceneOfEpisode)
          console.log('imagePrompt:', parsed.scene.imagePrompt?.slice(0, 100))
          console.log('cast:', parsed.scene.cast?.map((c) => `${c.role}:${c.name}`).join(' | '))
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
