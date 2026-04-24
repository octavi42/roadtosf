# Road to SF — Group-Based Architecture

This document captures the architectural decision to move from a fixed 5-scene linear model to a group-based dynamic generation model. Read alongside `BRIEF.md` and `GAME_LOGIC.md`.

---

## Why we changed the model

The original design (fixed 5-scene spine, Sorting Hat ending) was a solid hackathon starting point but has a fundamental UX ceiling: players see the same scenes every run. The only variation is the ending label and the cold-open callback line. This limits replayability and weakens the "my choices mattered" feeling.

The group-based model fixes this while keeping the generation cost manageable via parallel asset generation.

---

## Structure

```
Group 1 (3–4 scenes)
  └── Player makes choices
  └── Last choice fires Group 2 generation

→ Twist Card ("Word travels fast in SF.")
  └── Natural loading buffer — narratively justified
  └── Buys 3–5 seconds while Group 2 assets arrive

Group 2 (3–5 scenes)  ← fully pre-generated, zero wait
  └── Story arc shaped by Group 1 choice history
  └── Player makes choices
  └── Last choice fires Group 3 generation

→ Twist Card
  └── Same pattern

Group 3 (3–4 scenes)  ← fully pre-generated
  └── Final scene leads into ending classifier

→ Ending + Share Card
```

Total scenes: 9–13 depending on group sizes. Groups have variable lengths (3–10 scenes per the design intent) to prevent the player from anticipating scene count.

---

## Generation pipeline

### Within a group
All images for scenes in the group are generated **in parallel** the moment the group arc is available. A 4-scene group fires 4 image requests simultaneously. TTS audio can also be pre-generated per dialogue line in parallel.

### Between groups
Generation of Group N+1 fires **immediately after the player makes the last choice of Group N** — not at the start of Group N. This means:

- We have the full choice history for Group N before generating Group N+1
- The Twist Card acts as the loading screen — it is not a fake delay, it is the real generation window
- No speculative branching needed — we generate one arc based on actual choices made

### Why not speculative generation?
Generating both possible Group 2 branches in parallel (before knowing the player's last Group 1 choice) was considered and rejected:
- 2x LLM cost per transition
- 2x image generation cost
- Complexity not justified when the Twist Card gives sufficient buffer time

---

## Twist Card

The card between groups is a **load-bearing narrative device**, not a loading spinner. Requirements:

- Must feel earned — one sentence that reacts to the last choice made
- Delivered by the narrator, not a character
- Holds for minimum 3s, maximum until generation completes (whichever is longer)
- If generation finishes early, card holds the full 3s anyway (avoid jarring instant transitions)
- If generation takes longer than ~8s, show a secondary ambient line to fill time

Example twist cards:
- *"Word travels fast in SF."*
- *"Your phone hasn't stopped buzzing since."*
- *"The Caltrain was late. You had time to think."*
- *"TechCrunch published at 6 AM. You saw it at 6:01."*

---

## What each group generates

When Group N+1 generation fires, a single LLM call returns:

```json
{
  "twistCard": "Word travels fast in SF.",
  "scenes": [
    {
      "id": 4,
      "title": "Scene 4 · The Fallout",
      "imagePrompt": "...",
      "dialogue": [...],
      "choices": [
        { "id": "a", "label": "...", "hype": 1, "integrity": -1 },
        { "id": "b", "label": "...", "hype": -1, "integrity": 1 }
      ]
    }
  ]
}
```

Choice labels are still authored by the LLM but constrained to ≤8 words. Stat deltas are LLM-suggested but clamped to ±2 per choice to prevent runaway vectors.

Images are generated in parallel immediately after this response arrives — one request per scene using the `imagePrompt` field.

---

## Stat model — unchanged

The hype/integrity axes from `GAME_LOGIC.md` carry over unchanged. The Sorting Hat ending classifier still runs at the end of Group 3. The group model does not change *what the ending means*, only *how rich the path to it feels*.

---

## Game state machine

```
Phase: api-keys
  └── Phase: intro (conversational onboarding)
  └── Phase: generating (Group 1 generation — LLM + images + TTS in parallel)
  └── Phase: group (active group playback)
       └── scene-index within group
       └── on last choice → fire next group generation → Phase: twist-card
  └── Phase: twist-card (narrative buffer + loading)
       └── when generation complete + min 3s elapsed → Phase: group (next group)
  └── Phase: ending
```

---

## Key constraints

- **Choice labels are LLM-generated but fixed per group** — once a group is generated, labels do not change. Never regenerate mid-playback.
- **Stat deltas are LLM-suggested, engine-clamped** — LLM proposes ±1 or ±2, game engine clamps and applies. LLM never directly writes the final vector.
- **Fallback arc** — if group generation fails or times out, fall back to a pre-authored static group (one per slot). Player never sees a broken state.
- **No visible loading indicators during group playback** — all generation happens in the background. The only moment the player is aware of generation is the Twist Card, and it is dressed as narrative.
- **Images use base64 data URLs** — fal.ai/generation URLs expire in ~1hr. All images are converted to base64 at generation time and stored in client state.

---

## Implementation order

1. Update `types.ts` — replace `Scene[]` flat array with `Group[]` containing `Scene[]`, add `twistCard` field, add group generation status.
2. Create `/api/generate-group` route — takes `{choiceHistory, groupIndex, startupName, founderPersona}`, returns full group JSON.
3. Update game state machine in `page.tsx` — add `twist-card` phase, group index, within-group scene index.
4. Wire parallel image generation — after group JSON arrives, fire all image prompts simultaneously.
5. Wire TTS pre-generation — after group JSON arrives, fire TTS for all dialogue lines simultaneously.
6. Build Twist Card component — narrative line + ambient animation, holds until ready.
7. Connect generation trigger — on last choice of each group, immediately call `/api/generate-group` for next group.
8. Build fallback static groups — one authored fallback per group slot, used if generation fails.