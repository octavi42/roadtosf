@AGENTS.md

# Road to SF — Design Context & Decisions

This file captures brainstorm decisions made during design sessions. Read this alongside `BRIEF.md` and `GAME_LOGIC.md` before implementing anything.

---

## Game Flow (locked)

```
INTRO PHASE
  └── Cinematic landing: "Your flight to SFO departs in 6 hours"
  └── API key setup (framed as: "You'll need capital for this trip")
  └── Conversational input — player talks, agent extracts startup + self-description
  └── "Ticket purchased" confirmation → loading cinematic fires

GENERATION PHASE (5s LLM arc call, hidden behind cinematic)
  └── "You just landed at SFO. Your co-founder is already texting."
  └── Arc JSON + Scene 1 assets pre-generating in parallel

GAME LOOP (5 scenes)
  └── Scene renders: voiced dialogue, character portrait, 15s timer
  └── Choice window: 3 pre-authored options OR free-text (Scene 3 only)
  └── Stat delta fires silently, tonal flag updates
  └── Transition card → next scene (assets already preloaded)

ENDING
  └── Quadrant classified → ending label + epilogue paragraph
  └── Share card: startup name, ending, epilogue, virality stat
  └── Achievements unlocked (shown for the first time here)
```

---

## Intro — Conversational Onboarding

- The intro is a narrative device, not a form. "You just bought your one-way ticket to SF" frames the whole setup.
- API key entry is framed as in-world ("you'll need capital for this trip").
- The player talks freely about their project, life, ambitions, people they admire, fears.
- The agent extracts exactly two fields from whatever the player says:
  - `startupName` + startup description
  - `selfDescription` (tone register: anxious first-timer, cynical serial founder, etc.)
- Flavor tags (SF people mentioned, accelerators referenced, interests) are extracted silently and seeded into the story as fate — NOT as a preference menu.
- The player never gets asked "who do you want to meet?" — they discover it.

---

## Choice System

- 3 pre-authored choice labels per scene (≤8 words each, never generated at runtime).
- Scene 3 (the VC term sheet) is the ONE exception: adds a free-text counter-offer input in addition to the two binary choices.
- "Talk to agent" as a free-form mode per scene was considered and rejected — it breaks the authored-feel and introduces latency/reliability problems.
- Free-text is Scene 3 only. That's the wildcard moment. It doesn't scale to other scenes.

---

## Famous SF Characters, Places & Accelerators

- Real SF landmarks, accelerators (YC, a16z, Sequoia), and famous figures are seeded into the story.
- They appear as fate, not player choice.
- Real people are kept as archetypes — obviously recognizable but not named directly. Funnier and legally safer. The joke lands when the player connects the dots.
- Examples: "a Thiel-coded VC", "a Sand Hill Road partner", "a hoodie-wearing guy everyone seems to know", "the YC partner with the blog".
- Real places can be named: Tartine, Caltrain, Rosewood Sand Hill bar, the YC batch house, SFO arrivals, etc.
- Flavor tags extracted from the intro conversation seed which cameos and places appear.

---

## Mystery vs. Expression — DECIDED: Keep the Mystery

The mystery IS the product. Decision locked.

**Why mystery wins:**
- The Spotify Wrapped effect: people share because it surprised them. Self-selected encounters have zero shareability.
- The Sorting Hat principle (from GAME_LOGIC.md): the world must feel like it's reading the player, not obeying them. The moment the player expresses preferences mid-game, the illusion breaks.
- Choice fatigue: 5 timed decisions is already the right load. "Who do you want to meet?" between scenes adds cognitive load with no dramatic payoff.

**Where expression is allowed (intro only):**
- Player mentions people/places/interests in the conversational intro.
- Agent extracts as silent flavor tags.
- Story delivers them as fate — the player feels *seen*, not served.

---

## Achievements System

- Achievements are a mystery — you don't know they exist until you unlock one.
- Revealed for the first time on the ending/share card.
- Triggered by behavior (choices, timeouts, stat thresholds, cameo encounters), never by player preference.
- "You unlocked 2 of 12 achievements" on the share card creates FOMO and drives replay.
- This is the replay mechanic — no need to build an explicit replay mode.

**Example achievements:**
| Achievement | Trigger |
|---|---|
| **The Blessing** | Thiel-coded VC offers money in Scene 3 and you walk |
| **Name Drop** | You mention a real SF place in intro and it appears in the story |
| **The Pilgrim** | Every choice leads to GHOSTED ending |
| **Caltrain Moment** | You time out on 3+ choices |
| **Altman'd** | Sam-coded cameo fires when Hype axis hits +4 |
| **Founder Mode** | You override your co-founder AND fire them |

---

## Epilogue Paragraph (highest priority feature)

The epilogue is the single most important shareable artifact. It names specific choices AND specific SF places/people encountered:

> *You took Thiel's money, ghosted your co-founder at Tartine, and said "$10M ARR" on stage with $80K MRR. The SEC called Monday. Wagr now has 12 employees and sells compliance software.*

- One extra LLM call at the end, ~80 tokens, references full choice history + cameos encountered.
- Screenshot-optimized layout on the share card.
- Never make the player write the caption — prefill X/LinkedIn share text.

---

## What NOT to Build (consolidated)

- Per-scene "talk to agent" free-form mode (latency + reliability disaster)
- "Who do you want to meet?" mid-game preference menus (breaks the mirror illusion)
- Visible stat bars (kills role-play per Mass Effect cautionary tale)
- Runtime-generated choice labels (latency + reliability disaster)
- Starting stats derived from player input (destroys "I earned this" feeling)
- Named real people directly (archetype them instead)
- Every-scene multi-choice (doubles authoring scope)
- Alternate-antagonist explicit replay mode (achievements handle replay naturally)