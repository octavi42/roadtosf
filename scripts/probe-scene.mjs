// Hits /api/generate-scene with a realistic Episode skeleton (with
// pre-fixed scene plans) and reads the SSE stream. Each call returns
// ONE BEAT — dialogue + choices + isLastBeatOfScene. Multiple beats
// per scene flow inside the same scene container.
//
// Usage:
//   PORT=3000 node scripts/probe-scene.mjs                                # scene 0 beat 0
//   PORT=3000 SCENE=0 BEAT=1 PRIOR="Walk over to Maya" node scripts/probe-scene.mjs
//   PORT=3000 SCENE=2 BEAT=0 node scripts/probe-scene.mjs

const SCENE = Number(process.env.SCENE ?? 0)
const BEAT = Number(process.env.BEAT ?? 0)
const PRIOR = process.env.PRIOR ?? null
const port = process.env.PORT ?? '3001'
const url = `http://localhost:${port}/api/generate-scene`

const episode = {
  episodeIndex: 0,
  theme: 'First night in SF — the YC co-working space at 11pm',
  premise:
    'You crash the YC space your first night. The room is mostly empty but three people are still here, each wanting something different from you.',
  cast: [
    { role: 'cofounder', name: 'Maya', blurb: 'Wants to be your cofounder; has equity terms drafted.' },
    { role: 'hater', name: 'Brandon', blurb: 'Competing CEO with $4M and a year head start.' },
    { role: 'mentor', name: 'Linda', blurb: 'Partner emeritus at YC; closes her book and asks if you have eaten.' },
  ],
  scenes: [
    {
      index: 0,
      role: 'cofounder',
      setting: 'YC co-working space, kitchen island, 11pm Tuesday',
      cast: [{ role: 'cofounder', name: 'Maya' }],
      topic: 'Maya pitches herself as your cofounder; you can probe her motivation, push back on terms, or end the conversation.',
      imagePrompt:
        'interior of a YC co-working space kitchen at night, warm fluorescent overhead, a young woman with a hoodie and laptop leaning across a kitchen island toward the founder',
      title: 'The Kitchen Pitch',
    },
    {
      index: 1,
      role: 'hater',
      setting: 'espresso machine in the back hallway, ten minutes later',
      cast: [{ role: 'hater', name: 'Brandon' }],
      topic: 'Brandon greets you by name and probes for weaknesses; you can dodge, deflect, or counter.',
      imagePrompt:
        'espresso machine in a back hallway of a co-working space, two people in their late 20s, cinematic two-shot, golden lamplight',
      title: 'Espresso With The Enemy',
    },
    {
      index: 2,
      role: 'mentor',
      setting: 'a corner couch in the same YC space, midnight',
      cast: [{ role: 'mentor', name: 'Linda' }],
      topic: 'Linda closes her book; the question is a test. You can be honest, deflect, or ask a question back.',
      imagePrompt:
        'interior of a co-working common area at midnight, an older woman with reading glasses on a corner couch closing a hardback book, founder approaching, soft warm lighting',
      title: 'The Question About Dinner',
    },
  ],
  seedIds: [],
  startLLMIndex: 0,
}

const body = {
  episode,
  episodeIndex: 0,
  sceneIndexInEpisode: SCENE,
  beatIndex: BEAT,
  priorBeatsDialogue:
    BEAT > 0
      ? [
          { speaker: 'narrator', text: 'The kitchen island is half-empty espresso cups and a sourdough crust.' },
          { speaker: 'cofounder', text: "I built the deck on the BART ride over. I think we both know what's missing." },
          { speaker: 'player', text: 'You think you know.' },
        ]
      : [],
  priorBeatChoice: PRIOR
    ? { sceneId: 9 + BEAT, choiceLabel: PRIOR, hypeDelta: 0, integrityDelta: 1 }
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

console.log('POST', url, 'scene', SCENE, 'beat', BEAT, PRIOR ? `prior="${PRIOR}"` : '(no prior)')
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
        if (parsed.beat) {
          console.log('source:', parsed.source)
          console.log('sceneId:', parsed.sceneId)
          console.log('isLastBeatOfScene:', parsed.beat.isLastBeatOfScene)
          console.log('isLastSceneOfEpisode:', parsed.beat.isLastSceneOfEpisode)
          console.log('dialogue:')
          for (const d of parsed.beat.dialogue ?? []) {
            console.log(`  [${d.speaker}] ${d.text}`)
          }
          console.log(
            'choices:',
            parsed.beat.choices?.map((c) => `${c.id}:${c.label}`).join(' | '),
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
