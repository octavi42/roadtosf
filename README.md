# Road to SF

**[roadtosf.vercel.app](https://roadtosf.vercel.app)**

An AI-driven interactive-fiction game where you play your own startup's first week in San Francisco. Tell it about your real idea, and a personalized 5-scene arc unfolds — voiced cameos from real SF figures (Sam Altman, Peter Thiel, Paul Graham, Garry Tan…), timed choices, and one of five endings ranging from IPO to indicted.

Built for the Zed + ElevenLabs hackathon (April 2026).

---

## What it does

1. **Conversational onboarding.** You talk freely about your startup, your background, and the people you admire. An agent silently extracts your startup name, your founder register, and flavor tags (people, places, accelerators) that get seeded into the story as fate.
2. **Streamed arc generation.** A single Claude Sonnet 4.6 call streams a structured 5-scene arc with branches, dialogue, and authored choice labels. Scene 1 starts rendering before the rest of the arc finishes.
3. **Five timed scenes.** Each scene is voiced (ElevenLabs), portrait-illustrated, and ends in a 15-second timed choice. Scene 3 — the VC term sheet — adds a free-text counter-offer.
4. **Sorting-Hat ending.** Choices nudge two hidden axes (Hype, Integrity). The final vector classifies into one of five endings: IPO, Indicted, Acqui-hire, AI-Wrapper Pivot, or Ghosted.
5. **Personalized epilogue + share card.** A final ~80-token call writes a one-paragraph epilogue that names the choices you made and the SF figures/places you encountered. The screenshot is the viral artifact.

The mystery is the product: achievements, cameos, and ending paths are never offered as menus — they're discovered.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind v4 |
| Story arc | Claude Sonnet 4.6 (streamed, structured output) |
| Per-scene dialogue + cold-opens | Claude Haiku 4.5 |
| TTS | ElevenLabs Conversational AI agents (one per archetype) |
| Voice input | ElevenLabs Scribe Realtime (intro mic capture) |
| Image gen | OpenAI `gpt-image-2`, hosted on Vercel Blob |
| Persistence | Neon Postgres (playthrough capture, cameo pool) |
| Auth | iron-session cookies + Resend email OTP |
| Payments | Stripe (paywall after free playthrough) |
| Hosting | Vercel — `main` auto-deploys to production |

---

## Local development

```bash
npm install
cp .env.example .env.local   # fill in keys — see below
npm run db:migrate           # apply migrations 0001–0006 to your Neon instance
npm run dev                  # http://localhost:3000
```

Required env vars (full list in `.env.example`):

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`
- `ELEVENLABS_AGENT_{VC,COFOUNDER,REPORTER,HATER,MENTOR}` — five agent IDs from the ElevenLabs dashboard
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob, for scene images)
- `DATABASE_URL` (Neon pooled connection string)
- `STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `RESEND_API_KEY`, `RESEND_FROM` (verified sending domain)
- `RTSF_SESSION_SECRET` — `openssl rand -base64 48`

### Useful scripts

```bash
npm run dev                       # webpack dev server
npm run dev:turbo                 # turbopack
npm run build && npm run start    # prod build
npm run lint
npm test                          # vitest
npm run db:migrate                # apply Neon migrations

npm run generate:portraits        # regenerate locked archetype portraits
npm run generate:intro            # regenerate intro cinematic stills
npm run generate:static-audio     # rebuild canned voice lines
npm run seed:people               # seed the cameo pool
npm run scrape:stories            # ingest Silicon Mania source material
```

---

## Project layout

```
src/
├── app/
│   ├── page.tsx                  # Intro / onboarding
│   ├── history/                  # Past playthroughs (auth-gated)
│   └── api/
│       ├── extract-facts/        # Pull startup + tags from intro chat
│       ├── pick-lore/            # Choose cameos from the seeded pool
│       ├── generate-episode/     # Stream the full 5-scene arc
│       ├── generate-scene/       # Per-scene cold-open + dialogue
│       ├── generate-epilogue/    # Final personalized paragraph
│       ├── generate-image/       # gpt-image-2 → Vercel Blob
│       ├── tts/                  # ElevenLabs voice synthesis
│       ├── elevenlabs/           # Agent signed-URL minting
│       ├── scribe-token/         # Scribe Realtime auth
│       ├── narrator-ask/         # Disco-Elysium-style internal monologue
│       ├── paywall/              # Stripe checkout + verify
│       ├── auth/                 # Email OTP login
│       ├── credits/              # Replay credit ledger
│       ├── playthroughs/         # Save + retrieve past runs
│       └── admin/                # Ingest + cameo refresh
├── components/                   # SceneCard, ChoiceButton, ShareCard, etc.
├── hooks/                        # useStory, useAudio, useAssetPreloader
└── lib/
    ├── prompts/                  # All LLM prompt templates
    ├── schemas/                  # Zod schemas for structured outputs
    ├── lore/, cameos/            # SF cameo and place catalog
    ├── silicon-mania/            # Tone source material
    ├── voices/                   # ElevenLabs voice IDs per archetype
    ├── streamEpisode.ts          # Arc streaming + parsing
    ├── streamScene.ts            # Per-scene streaming
    ├── playthroughs.ts           # DB persistence layer
    └── paywall.ts, credits.ts, stripe.ts
```

---

## Design docs

The decisions behind the game are checked in:

- `BRIEF.md` — original scope, constraints, and 6-day build plan
- `CLAUDE.md` — design decisions locked during brainstorm (intro flow, mystery vs. expression, real-name policy)
- `GAME_LOGIC.md` — the Sorting-Hat ending model, axis math, scene anatomy, callback rule
- `GROUP_ARCHITECTURE.md` — cameo pool and group selection
- `LORE_SYSTEM.md`, `LORE_PICKER_BRIEF.md` — how SF flavor gets injected
- `RUNWAY_AXIS.md` — axis tuning notes
- `BUSINESS.md`, `PRICING_RECOMMENDATION.md` — paywall + pricing model
- `DEPLOY.md` — production checklist
- `AGENTS.md` — note: this is Next.js 16, not the version in your training data — read `node_modules/next/dist/docs/` before assuming APIs

---

## License

Private project, all rights reserved.
