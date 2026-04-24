# roadtosf — Project Brief

## What I'm building
A Telltale-style branching narrative game where the player inputs their startup idea + a description of themselves, and the game generates a personalized 15-minute story of their first week as a founder in SF, in the "Silicon Mania" (SF tech satire) aesthetic. Voiced characters, branching choices, shareable ending card.

## Why
Submission for the Zed + ElevenLabs hackathon. Deadline: 2026-04-30 17:00. Scoring favors polish + virality + emotional impact. Target: a 60-sec demo video shows a real founder running their real startup through it and reacting to the ending.

## Game structure (locked)
- Input screen: "What's your startup?" + "Describe yourself"
- 5 scenes, 5 timed choices per playthrough, ~15 min total
- Fixed archetype cast (solves character consistency):
  1. The VC (Thiel-coded)
  2. The co-founder
  3. The TechCrunch reporter
  4. The hater / competitor
  5. The mentor
- Scene beats (structure fixed, content personalized by LLM):
  1. Co-founder pitches a pivot — back them or override
  2. Reporter offers puff piece for a scoop — leak or protect
  3. VC offers money with strings — take or walk
  4. Team trust crisis — confront, fire, or exploit
  5. Demo Day — play safe or full hype
- Endings: IPO / acqui-hire / indicted / pivot-to-AI-wrapper / ghosted
- Final screen: personalized share card ("your SF week in one image") + stats
  ("only 8% of players fired their co-founder")

## Tech stack
- Next.js 15 + TypeScript + Tailwind (web app — shareable link = viral vector)
- Deploy: Vercel
- Image gen: fal.ai → `fal-ai/gpt-image-2` (OpenAI direct API doesn't open until after the hackathon deadline). Medium quality 1024², ~3s/image, ~$0.05/image.
  Use image-to-image `edit` endpoint with locked reference portraits for character consistency.
- Voice: ElevenLabs JS SDK (TTS, pick 5 distinct voices for the archetypes)
- Story gen: OpenAI or Anthropic chat completions — LLM pre-plans all 5 beats upfront in one call, then generates per-scene dialogue on demand
- No DB needed — stateless per-playthrough, in-memory React state
- Audio playback: HTML5 audio or Howler.js

## Generation pipeline (critical — get this right)
1. Player submits startup + self description
2. LLM call #1: generate the full 5-beat story arc as structured JSON (all scenes, all choice branches, all dialogue) — ~5s
3. Scene 1 renders while we pre-generate scene 1's image + voices in parallel
4. Streaming: scene N+1's assets generate while scene N plays
5. Per-scene parallel: image (~3s) + voice lines (~1-2s per character line) — hide behind transition cards ("the next morning...")
6. Ending: runtime-generate one personalized hero image (5-10s, acceptable UX for endgame)

## Constraints
- Must use Zed as the editor (screen-record for submission video)
- Must use ElevenLabs APIs meaningfully (they're the sponsor — voice IS the game)
- 6 days total, assume ~25 real work hours
- Quality over scope — polished 10-min experience beats ambitious 30-min mess
- Viral-first: every design choice should favor "would a founder share this clip?"

## Project structure (proposed)

```
roadtosf/
├── BRIEF.md                        # This file
├── .env.local                      # API keys (never commit)
├── .env.example                    # Key names, no values
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
│
├── public/
│   └── portraits/                  # Locked reference portraits for each archetype
│       ├── vc.png
│       ├── cofounder.png
│       ├── reporter.png
│       ├── hater.png
│       └── mentor.png
│
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                # Input screen
    │   ├── play/
    │   │   └── page.tsx            # Main game screen (reads state from URL/context)
    │   └── api/
    │       ├── generate-story/
    │       │   └── route.ts        # LLM call #1 — full arc JSON
    │       ├── generate-scene/
    │       │   └── route.ts        # Per-scene image + voice asset generation
    │       ├── generate-voice/
    │       │   └── route.ts        # ElevenLabs TTS proxy
    │       └── generate-image/
    │           └── route.ts        # fal.ai image proxy
    │
    ├── components/
    │   ├── InputScreen.tsx         # Startup idea + self description form
    │   ├── LoadingScreen.tsx       # "The algorithm is judging you…" splash
    │   ├── SceneCard.tsx           # Renders one scene: portrait, dialogue, timer
    │   ├── ChoiceButton.tsx        # Timed choice with progress bar
    │   ├── TransitionCard.tsx      # "The next morning…" beat between scenes
    │   ├── EndingScreen.tsx        # Outcome reveal + share card
    │   └── ShareCard.tsx           # The viral OG image — generated hero art + stats
    │
    ├── lib/
    │   ├── types.ts                # All shared TypeScript types
    │   ├── archetypes.ts           # Character definitions, voice IDs, portrait paths
    │   ├── prompts.ts              # LLM system + user prompt templates
    │   ├── elevenlabs.ts           # ElevenLabs SDK wrapper
    │   ├── fal.ts                  # fal.ai client wrapper
    │   └── story.ts                # Story state machine + asset pre-fetch logic
    │
    └── hooks/
        ├── useStory.ts             # Central game state + scene progression
        ├── useAudio.ts             # Audio queue, playback, preloading
        └── useAssetPreloader.ts    # Pre-generates N+1 scene assets while N plays
```

## Key types (strawman — lock these early)

```typescript
// lib/types.ts

type Archetype = 'vc' | 'cofounder' | 'reporter' | 'hater' | 'mentor'

interface DialogueLine {
  speaker: Archetype | 'player'
  text: string
  audioUrl?: string       // filled in after ElevenLabs call
}

interface Choice {
  id: string
  label: string
  consequence: string     // short internal note for LLM continuity
  nextSceneHint: string
}

interface Scene {
  id: number              // 1–5
  title: string           // e.g. "The Pivot"
  imageUrl?: string       // filled in after fal.ai call
  dialogue: DialogueLine[]
  choices: Choice[]
  timeoutSeconds: number  // default 15
  timeoutChoice: string   // which choice ID fires on timeout
}

interface StoryArc {
  startupName: string
  founderPersona: string
  scenes: Scene[]
  endingKey: 'ipo' | 'acquihire' | 'indicted' | 'ai-wrapper' | 'ghosted'
  endingNarrative: string
  shareCardPrompt: string // image gen prompt for final hero art
  stats: Record<string, string>
}
```

## Concerns with the proposed stack

### 1. fal.ai `gpt-image-2` model availability
- **Risk:** `fal-ai/gpt-image-2` may have rate limits, queue delays, or model naming differences from what's documented. Image-to-image "edit" mode for character consistency is the right call but needs a working reference image upload flow.
- **Mitigation:** Prototype fal.ai on Day 1. Have a fallback to `fal-ai/flux/schnell` (fast, free tier) for development — swap to gpt-image-2 only for demo polish.

### 2. ElevenLabs latency vs. UX flow
- **Risk:** 1–2s per voice line sounds fast but a scene with 6 dialogue lines = 6–12s of serial TTS calls. If we batch them, we need to handle streaming audio queue carefully.
- **Mitigation:** Pre-generate all lines for Scene N+1 during Scene N playback. Store as blob URLs in React state. Never block the player on TTS.

### 3. LLM JSON structure reliability
- **Risk:** The full 5-scene arc as one JSON blob is ~2–4k tokens of structured output. GPT-4o with `response_format: { type: "json_object" }` is reliable but not perfect — malformed JSON breaks the whole game.
- **Mitigation:** Use Zod schema validation on the API route. On parse failure, retry once with the error message appended. Hard-fallback to a pre-written "generic founder" arc so the game never crashes on the input screen.

### 4. Stateless architecture + shareable links
- **Risk:** "No DB" means the share card URL can't reconstruct the full game state — the image URL from fal.ai will expire, and React state is gone on refresh.
- **Mitigation:** For MVP, the share card is a screenshot-and-share UX (html2canvas or dom-to-image). The "shareable link" is just the app homepage. Add a short URL with base64-encoded minimal state (endingKey + startup name + stats) as a stretch goal.

## 3 riskiest unknowns — prototype first

### Risk #1: fal.ai image pipeline (Day 1)
Can we generate a character-consistent scene image in ~3s at acceptable quality? This is the most novel integration with the least fallback.
- **Prototype goal:** Hit the fal.ai API, get an image, render it. Measure real latency. Confirm the edit/img2img endpoint works with a local reference portrait.

### Risk #2: ElevenLabs TTS → audio playback loop (Day 1–2)
Can we call ElevenLabs, get audio bytes, play them back in sequence in the browser without gaps or race conditions?
- **Prototype goal:** Generate 3 dialogue lines for a hardcoded scene, play them one after another with character voice IDs. Confirm latency is preloadable.

### Risk #3: LLM story arc JSON quality (Day 2)
Will the LLM produce a coherent, personalized, funny arc in one shot, or does it need iteration?
- **Prototype goal:** Run 5 different startup inputs through the prompt. Score the output quality. Tune the prompt until it's reliably sharp + satirical.

## Recommended 6-day build order

### Day 1 — Walking skeleton (most important day)
- [ ] Scaffold Next.js 15 app, Tailwind, TypeScript
- [ ] `.env.local` with all API keys
- [ ] Hardcode a single scene (no LLM) — render it with a static image + static text
- [ ] **Prototype spike:** fal.ai image call, render result
- [ ] **Prototype spike:** ElevenLabs TTS call, play audio in browser
- [ ] End of day: image + voice both working in isolation

### Day 2 — End-to-end skeleton
- [ ] LLM story arc generation API route (Zod-validated)
- [ ] Input screen → LLM call → parse arc → render Scene 1 (real content, real image, real voice)
- [ ] Choice selection → Scene 2 (even if image/voice are placeholders)
- [ ] End of day: one real playthrough from input to Scene 2 works

### Day 3 — Full playthrough + state machine
- [ ] All 5 scenes render with correct branching logic
- [ ] Asset preloader hook (`useAssetPreloader`) — Scene N+1 generates while N plays
- [ ] Transition cards between scenes
- [ ] Timed choice with countdown bar
- [ ] Ending screen with correct ending key

### Day 4 — Polish + share card
- [ ] All 5 archetype voice IDs locked and sounding distinct
- [ ] Scene images with character portraits (img2img consistency)
- [ ] Share card: dom-to-image snapshot of ending screen with stats
- [ ] Loading states + error handling (retry logic, fallback arc)
- [ ] Timeout choice fires correctly

### Day 5 — Content + vibe
- [ ] Tune LLM prompt for sharpness, satire, founder-specific personalization
- [ ] Write fallback arc for LLM failure
- [ ] Ending texts for all 5 outcomes
- [ ] "Silicon Mania" visual aesthetic — fonts, colors, scanline overlay, UI chrome
- [ ] Sound design: ambient background audio per scene

### Day 6 — Demo video + submission
- [ ] Run 3 real founders through the game, fix any sharp edges
- [ ] Record 60-sec demo video in Zed (as required by hackathon)
- [ ] Deploy to Vercel, confirm production works
- [ ] Write submission copy
- [ ] Submit before 17:00

## API keys needed
```
OPENAI_API_KEY=           # Story generation
ANTHROPIC_API_KEY=        # Backup LLM
FAL_KEY=                  # Image generation
ELEVENLABS_API_KEY=       # Voice synthesis
```

## ElevenLabs voice IDs (to be locked Day 1)
| Archetype | Vibe | Voice to audition |
|---|---|---|
| VC | Measured, patrician, slightly menacing | Adam or Clyde |
| Co-founder | Nervous energy, startup-bro cadence | Josh or Antoni |
| Reporter | Bright, fast-talking, slightly performative | Rachel or Bella |
| Hater | Snide, dismissive, too-cool-for-school | Sam or Arnold |
| Mentor | Warm, deliberate, seen-it-all gravitas | Daniel or Thomas |

## Definition of done (hackathon submission)
- [ ] Real founder inputs real startup → gets a personalized, voiced, branching story
- [ ] At least 3 meaningfully different endings reachable
- [ ] Share card renders with startup name + ending + at least one stat
- [ ] Deployed and publicly accessible on Vercel
- [ ] 60-sec demo video recorded in Zed
- [ ] ElevenLabs voice used for all character dialogue (not optional)
```

Now here's the full analysis you asked for.

---

## Proposed project structure

See the `BRIEF.md` just saved — the full folder tree is in there. Key decisions:

- **`src/app/api/`** has four routes: `generate-story`, `generate-scene`, `generate-voice`, `generate-image`. Keeping image and voice as thin server-side proxies means API keys never touch the browser, and you get a natural place to add retry logic and Zod validation.
- **`src/lib/`** separates concerns cleanly: `archetypes.ts` owns the cast (voice IDs, portrait paths, personality notes for prompts), `story.ts` owns the state machine, `prompts.ts` owns all LLM strings in one place so tuning is fast.
- **`src/hooks/`** has three hooks: `useStory` (game state + scene progression), `useAudio` (queue + playback), `useAssetPreloader` (the N+1 prefetch logic). These are the hardest pieces — isolating them makes testing easier.

---

## Stack concerns (4 real ones)

**1. fal.ai img2img consistency is untested territory.** The edit endpoint exists, but "character consistency" with reference portraits is a soft guarantee, not a hard one. Expect some drift. Budget time on Day 1 to validate this actually works at your quality bar — if it doesn't, the fallback is illustrated scene cards (no character portraits, just mood/setting images) which still look great and cut the risk entirely.

**2. ElevenLabs serial TTS latency adds up fast.** A scene with 6 dialogue lines at 1.5s each is 9s of blocking calls if done serially. The preloader hook solves this, but it has to be built correctly from Day 2 — if you bolt it on later, you'll refactor half the state. Design `useAssetPreloader` before writing `useStory`.

**3. LLM JSON reliability at 5-scene depth.** The arc is large. Use `response_format: { type: "json_schema" }` (structured outputs, not just `json_object`) with OpenAI — it's meaningfully more reliable. Define the schema as a Zod object and derive the JSON schema from it with `zod-to-json-schema`. One call, one validation, one retry on failure.

**4. The "no DB + shareable" tension.** fal.ai image URLs expire (typically 1 hour). If your share card embeds the image URL, it'll be dead by the time someone opens the link. For the hackathon, the right answer is: **the share card is a PNG the user downloads/screenshots**, not a URL. Use `html2canvas` or `dom-to-image-more` to snapshot the ending screen client-side. No expiry, no DB, no problem.

---

## 3 riskiest unknowns — prototype these first

**Risk #1: fal.ai image pipeline** — Can you get a 1024² scene image in ~3s that looks good enough? And does img2img with a reference portrait actually maintain character likeness? This is the biggest unknown because you've never shipped it, and the game's visual identity depends on it. Prototype on Day 1 morning.

**Risk #2: ElevenLabs → browser audio queue** — Getting bytes from the API is easy. Playing 6 lines in sequence without gaps, race conditions, or "audio context suspended" browser errors is fiddly. Prototype on Day 1 afternoon with a hardcoded 3-line script.

**Risk #3: LLM arc quality at first-try** — The prompt needs to be funny, specific to the founder's actual startup, and produce valid JSON every time. This requires iteration. Prototype on Day 2 with 5 different inputs — you'll know by line 3 of the output whether the tone is right.

---

## 6-day order of work

Saved in full in `BRIEF.md`. The non-obvious philosophy:

- **Day 1 is all spikes, no features.** You're buying down risk, not building product. End of Day 1 you should have seen a fal.ai image and heard an ElevenLabs voice in the browser. Nothing else matters yet.
- **Day 2 is the skeleton.** Real LLM call, real content, real image, real voice, input → Scene 1 → Scene 2. Ugly is fine. This is the hardest day architecturally.
- **Days 3–4 are filling in the skeleton** — all 5 scenes, preloader, transitions, share card.
- **Day 5 is content.** The prompt tuning, the ending texts, the visual aesthetic. Most people do this first and run out of time to wire it together. Don't.
- **Day 6 is demo + ship.** No new features after noon. Record the video, deploy, submit.

The `BRIEF.md` is saved. Ready to scaffold the Next.js app whenever you say go.