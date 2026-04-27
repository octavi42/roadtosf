// Hits /api/generate-arc with a realistic payload and prints the raw response.
// Logs hit the dev server console so you can see Zod issues + payload there.

const body = {
  episodeIndex: 0,
  startupName: 'the startup',
  startupDescription: 'A city-guide AI agent that plans hyperlocal day trips for tourists.',
  founderPersona: '',
  stage: '',
  team: 'solo, no cofounder',
  fundingModel: 'bootstrapping, 6 months runway, no users yet',
  concern: "nobody trusts an AI travel planner that hasn't done a real city",
  flavorTags: [],
  recentChoices: [
    { sceneId: 1, choiceLabel: "I'm trying to do it right.", hypeDelta: 0, integrityDelta: 1 },
    { sceneId: 2, choiceLabel: 'A city-guide AI agent…', hypeDelta: 0, integrityDelta: 0 },
    { sceneId: 3, choiceLabel: 'Book the flight', hypeDelta: 0, integrityDelta: 0 },
    { sceneId: 4, choiceLabel: 'solo, no cofounder', hypeDelta: 0, integrityDelta: 0 },
  ],
  currentStats: { hype: 0, integrity: 1 },
}

const port = process.env.PORT ?? '3001'
const url = `http://localhost:${port}/api/generate-arc`
console.log('POST', url)
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const text = await res.text()
console.log('status', res.status)
console.log('--- response body ---')
console.log(text)
