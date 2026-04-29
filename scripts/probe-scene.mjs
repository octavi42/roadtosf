// Hits /api/generate-scene with a realistic Episode payload and reads the
// SSE stream. Episode-architecture rewrite: scene-gen now reads its own
// pre-fixed ScenePlan from the supplied Episode.
//
// Usage:
//   PORT=3009 node scripts/probe-scene.mjs            # scene 0
//   PORT=3009 SCENE=2 node scripts/probe-scene.mjs    # scene 2 (with prior choice)

const SCENE = Number(process.env.SCENE ?? 0)
const port = process.env.PORT ?? '3001'
const url = `http://localhost:${port}/api/generate-scene`

const episode = {
  episodeIndex: 0,
  theme: 'First night at the YC co-working space',
  premise:
    'A solo founder bootstrapping a city-guide AI agent crashes the YC space their first night in SF; three people they don\'t know yet are already there.',
  scenes: [
    {
      index: 0,
      role: 'cofounder',
      setting: 'YC co-working space, kitchen island, 11pm Tuesday',
      cast: [
        {
          role: 'cofounder',
          name: 'Maya',
          blurb: 'Ex-Stripe engineer, three coffees deep, has equity terms drafted.',
        },
      ],
      beat: 'A founder you barely know corners you at the kitchen island and pitches herself as your missing cofounder.',
      kind: 'encounter',
      imagePrompt:
        'interior of a YC co-working space kitchen at night, warm fluorescent overhead, a young woman with a hoodie and laptop leaning across a kitchen island toward the founder',
    },
    {
      index: 1,
      role: 'hater',
      setting: 'YC space espresso machine, ten minutes later',
      cast: [
        {
          role: 'hater',
          name: 'Brandon',
          blurb: 'CEO of a competing startup with $4M and a year head start.',
        },
      ],
      beat: 'You bump into a competitor\'s CEO at the espresso machine. He greets you by name.',
      kind: 'encounter',
      imagePrompt:
        'espresso machine in a back hallway of a co-working space, two men in their late 20s, cinematic two-shot, golden lamplight',
    },
    {
      index: 2,
      role: 'mentor',
      setting: 'corner couch in the same YC space, midnight',
      cast: [
        {
          role: 'mentor',
          name: 'Linda',
          blurb: 'Partner emeritus at YC. Has watched 200 startups fail.',
        },
      ],
      beat: 'A partner emeritus closes her book and asks if you\'ve eaten. The question is a test.',
      kind: 'encounter',
      imagePrompt:
        'interior of a co-working common area at midnight, an older woman with reading glasses on a corner couch closing a hardback book, founder approaching, soft warm lighting',
    },
  ],
  seedIds: ['cofounder_pitch_generic', 'hater_generic_dunk', 'mentor_generic_advice'],
  startLLMIndex: 0,
}

const body = {
  episode,
  episodeIndex: 0,
  sceneIndexInEpisode: SCENE,
  storySoFar: '',
  startupName: 'wagr',
  startupDescription: 'a city-guide AI agent for tourists',
  founderPersona: 'anxious first-time founder',
  team: 'solo, no cofounder',
  fundingModel: 'bootstrapping',
  recentChoices:
    SCENE === 0
      ? []
      : [
          {
            sceneId: 8 + SCENE,
            choiceLabel: 'Hear her out.',
            hypeDelta: 0,
            integrityDelta: 1,
          },
        ],
  currentStats: { hype: 0, integrity: 0 },
  playthroughId: 'probe-scene',
}

console.log('POST', url, 'scene', SCENE)
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
          console.log('role:', parsed.scene.role)
          console.log('title:', parsed.scene.title)
          console.log('imagePrompt:', parsed.scene.imagePrompt?.slice(0, 80))
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
