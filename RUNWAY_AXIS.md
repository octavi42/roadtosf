# Runway Axis — Design Context

Captured during epilogue-generation design session. Not yet implemented. Read this if/when we revisit "money as a game mechanic."

---

## The original question

Should the game run infinitely as long as the player adds money to it?

## Decision: NO to infinite, YES to runway-as-third-axis

Infinite-while-you-pay breaks the product. A bounded runway resource inside the existing 5-scene arc is the version that works.

---

## Why infinite breaks it

- **The epilogue stops working.** "You took Thiel's money, ghosted your co-founder at Tartine, and the SEC called Monday" only lands because the story is *over*. Open-ended runs don't have a Monday. The epilogue is the single most shareable artifact in this game (`CLAUDE.md`); anything that removes the verdict kills the share card.
- **The Sorting Hat collapses.** The locked 5 scenes, hidden stats, classifier, no-expression-mid-game are all engineered around "the world reads the player." The moment a player can extend their own arc by paying, the mirror becomes a treadmill and the magic dies.
- **Spotify Wrapped doesn't stream live.** Nobody shares "I'm currently 47 scenes deep." Sharing needs a verdict.
- **Achievements de-calibrate.** The 12-achievement set is tuned to a 5-scene arc. "2 of 12" creates FOMO; in an infinite run it becomes noise.
- **It changes the product.** Pay-to-continue pivots from a 10-minute viral toy to a freemium narrative game. Different business, different scope, not the hackathon submission.

---

## The version that works: runway as a third axis

Keep the 5-scene arc. Add runway alongside hype/integrity:

- Player starts with a fixed capital pool.
- Each scene burns runway. Some choices burn more than others (Rosewood bar dinner = expensive, Caltrain = cheap, ghosting your co-founder = free).
- Burn rates are authored per choice, not generated.
- If runway hits zero before scene 5 → **early ending: "OUT OF RUNWAY"** — a 6th quadrant with its own epilogue copy and its own achievement.
- Share artifact stays intact. Mystery stays intact. Closed arc stays intact.

The thematic payoff: founders die when they run out of money. This isn't metaphor, it's the literal sword every founder lives under. It also lets the API-key-as-capital intro framing pay off mechanically — the player's real API spend mirrors their startup's burn without ever saying "pay us more."

---

## What still needs to be designed (if we build this)

- Starting capital value (abstract number, e.g. 100, or in-fiction dollars).
- Per-scene baseline burn + per-choice deltas. Needs an authoring pass over all 5 scenes × 3 choices.
- Whether runway is visible to the player. Default: **hidden**, like hype/integrity, to preserve the Sorting Hat. Reveal only on the share card.
- "OUT OF RUNWAY" epilogue prompt + achievement.
- Whether scene 3's free-text counter-offer interacts with runway (e.g. lowballing the VC saves money but kills hype).

---

## What NOT to build

- Pay-to-continue / pay-to-extend. Closed arc is non-negotiable.
- Visible runway bar mid-game. Same reason hype/integrity are hidden.
- Runway as the *only* axis. It's a third pressure, not a replacement.
- Procedural runway events ("a bill arrived"). Burn comes from the choices already in the scene.

---

## Status

Parked. Resume after epilogue generation lands.
