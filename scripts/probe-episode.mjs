// Hits /api/generate-episode with a realistic payload and reads the SSE
// stream. Prints theme, premise, scene plans, and seed picks.
//
// Usage:
//   PORT=3009 node scripts/probe-episode.mjs                   # episode 0 (no priorChoice)
//   PORT=3009 EPISODE=1 LAST="Commit to the hackathon" node scripts/probe-episode.mjs

const EPISODE = Number(process.env.EPISODE ?? 0)
const LAST = process.env.LAST ?? null
const port = process.env.PORT ?? '3001'
const url = `http://localhost:${port}/api/generate-episode`

const body = {
  episodeIndex: EPISODE,
  priorStorySoFar:
    EPISODE > 0
      ? "You crashed at the YC space your first night and Maya offered to be your cofounder."
      : '',
  lastChoice: LAST
    ? { sceneId: 8, choiceLabel: LAST, hypeDelta: 0, integrityDelta: 1 }
    : undefined,
  startupName: 'wagr',
  startupDescription: 'a city-guide AI agent for tourists',
  founderPersona: 'anxious first-time founder',
  stage: 'pre-launch',
  team: 'solo, no cofounder',
  fundingModel: 'bootstrapping',
  targetCustomer: 'tourists in SF',
  concern: 'figuring out the GTM',
  flavorTags: ['ai', 'yc'],
  recentChoices: [],
  currentStats: { hype: 0, integrity: 0 },
  seed: 'probe-episode',
  firedSeedIds: [],
  playthroughId: 'probe-episode',
}

console.log('POST', url, 'episode', EPISODE, LAST ? `last="${LAST}"` : '(no lastChoice)')
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
        if (parsed.episode) {
          console.log('source:', parsed.source)
          console.log('credits remaining:', parsed.creditsRemaining)
          console.log('theme:', parsed.episode.theme)
          console.log('premise:', parsed.episode.premise)
          console.log('seedIds:', (parsed.episode.seedIds ?? []).join(', '))
          console.log('episode cast:')
          for (const c of parsed.episode.cast ?? []) {
            const ident = `[${c.gender ?? '?'}/${c.age ?? '?'}]`
            const desc = (c.descriptives ?? []).join(',')
            const voice = c.voiceId ? ` voice=${c.voiceId.slice(0, 6)}` : ' voice=MISSING'
            console.log(`  ${c.role}: ${c.name} ${ident} ${desc}${voice}`)
          }
          console.log('scenes:')
          for (const s of parsed.episode.scenes ?? []) {
            console.log(`  ${s.index}. ${s.title} (role=${s.role})`)
            console.log(`     setting: ${s.setting}`)
            console.log(`     cast: ${(s.cast ?? []).map((c) => `${c.role}:${c.name}`).join(' | ')}`)
            console.log(`     topic: ${s.topic}`)
            console.log(`     image: ${(s.imagePrompt ?? '').slice(0, 100)}`)
          }
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
