#!/usr/bin/env bun
// Smoke test for the storylet selector. Drives selectEpisodeStorylets
// through 6 player fixtures and prints which storylets each one picks.
// Run with:
//   bun run scripts/test-storylets.ts
//
// What you should see:
//   - Solo + bootstrapping never picks cofounder_walkout_named or any
//     vc_term_sheet_* cameo variant; instead picks solo_yc_recruit.
//   - Named cofounder + raising can pick cofounder_walkout_named.
//   - Thiel cameo + raising → vc_term_sheet_thiel becomes eligible.
//   - Altman cameo + hype 4 → mentor_altman_blessing fires.
//   - Cooldown test: a storylet fired in episode 0 is suppressed in
//     episode 1 (default cooldown = 2 episodes).
//   - Tier gating: episode 0 only eligible for early-tier storylets;
//     episode 3+ unlocks late-tier (e.g. mentor_gut_punch).

import { selectEpisodeStorylets } from '../src/lib/storylets/select'
import type { SelectionState } from '../src/lib/storylets/types'

interface Fixture {
  name: string
  state: SelectionState
}

const baseState = (overrides: Partial<SelectionState>): SelectionState => ({
  episodeIndex: 0,
  hype: 0,
  integrity: 0,
  storyletState: { fired: [], flags: {} },
  flavorTags: [],
  ...overrides,
})

const fixtures: Fixture[] = [
  {
    name: 'Solo + bootstrapping (no cameos, episode 0)',
    state: baseState({
      team: 'solo',
      funding: 'bootstrapping',
      flavorTags: ['founder', 'product'],
    }),
  },
  {
    name: 'Named cofounder + raising (no cameos, episode 0)',
    state: baseState({
      team: 'named',
      funding: 'raising',
      flavorTags: ['ai', 'fundraising'],
    }),
  },
  {
    name: 'Raising + Thiel cameo (episode 1, mid tier unlocked)',
    state: baseState({
      episodeIndex: 1,
      team: 'named',
      funding: 'raising',
      rolledCameos: ['peter-thiel', 'paul-graham', 'casey-newton'],
      flavorTags: ['fundraising', 'crypto'],
    }),
  },
  {
    name: 'High hype + Altman cameo (episode 1)',
    state: baseState({
      episodeIndex: 1,
      hype: 4,
      integrity: 1,
      team: 'named',
      funding: 'raising',
      rolledCameos: ['sam-altman', 'marc-andreessen'],
      flavorTags: ['ai', 'hype'],
    }),
  },
  {
    name: 'Late-game crisis (episode 3, hype 3 + integrity -3)',
    state: baseState({
      episodeIndex: 3,
      hype: 3,
      integrity: -3,
      team: 'named',
      funding: 'raising',
      // Flavor tags excluded "press" so reporter_hit_piece's
      // specificity boost (integrityLte: -2) outscores the empty-
      // requires reporter_generic_curiosity, which would otherwise
      // win on the "press" tag overlap.
      flavorTags: ['ai'],
    }),
  },
  {
    name: 'Non-encounter mix — early episode 0 (solo + world-event eligible)',
    state: baseState({
      episodeIndex: 0,
      hype: 0,
      integrity: -1,
      team: 'named',
      funding: 'raising',
      flavorTags: ['ai', 'press'],
    }),
  },
  {
    name: 'High-hype world-event run (episode 1, solo + world-event mid-tier)',
    state: baseState({
      episodeIndex: 1,
      hype: 4,
      integrity: 1,
      team: 'named',
      funding: 'raising',
      flavorTags: ['ai', 'hype'],
    }),
  },
  {
    name: 'Cooldown check — episode 1 with rich cameo set so suppression has alternatives',
    state: baseState({
      episodeIndex: 1,
      hype: 3,
      integrity: 1,
      team: 'named',
      funding: 'raising',
      flavorTags: ['ai', 'fundraising', 'press'],
      // With Thiel + PG + Casey + Marc cameos rolled, the eligible pool
      // is wide enough that cooldown suppression actually steers the
      // selector toward fresh storylets instead of degrading to the
      // fallback path. (When the eligible pool collapses to <5 slots,
      // the fallback ignores cooldown to fill the schema — that's by
      // design and not what we're testing here.)
      rolledCameos: ['peter-thiel', 'paul-graham', 'casey-newton', 'marc-andreessen'],
      storyletState: {
        fired: [
          { id: 'vc_cold_pitch_generic', firedAtEpisode: 0 },
          { id: 'cofounder_pitch_generic', firedAtEpisode: 0 },
          { id: 'reporter_generic_curiosity', firedAtEpisode: 0 },
          { id: 'hater_generic_dunk', firedAtEpisode: 0 },
          { id: 'mentor_generic_advice', firedAtEpisode: 0 },
        ],
        flags: {
          vcEncounter: true,
          cofounderEncounter: true,
          pressEncounter: true,
          twitterDunked: true,
          mentorEncounter: true,
        },
      },
    }),
  },
]

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

let failures = 0

const expect = (
  label: string,
  cond: boolean,
  detail: string,
): void => {
  if (cond) {
    console.log(`    ${GREEN}✓${RESET} ${label}`)
  } else {
    console.log(`    ${RED}✗ ${label}${RESET}`)
    console.log(`      ${DIM}${detail}${RESET}`)
    failures++
  }
}

for (const fx of fixtures) {
  console.log(`\n${BOLD}── ${fx.name}${RESET}`)
  const { storylets, finalState } = selectEpisodeStorylets(fx.state)
  const ids = storylets.map((s) => s.id)
  console.log(`  Picked: ${ids.join(', ') || '(none)'}`)
  console.log(`  ${DIM}Flags after: ${JSON.stringify(finalState.flags)}${RESET}`)

  // Universal assertion: no two storylets in one episode share the
  // same archetype (unless the eligible pool genuinely had no fresh
  // alternative — rare in practice). Tracks the bug from the
  // play-test data where one episode had 2 cofounder beats.
  const archetypes = storylets.map((s) => s.archetype)
  const uniqueArchetypes = new Set(archetypes).size
  expect(
    `archetype diversity (${uniqueArchetypes}/5 unique)`,
    uniqueArchetypes >= 4,
    `archetypes: ${archetypes.join(', ')}`,
  )

  // Per-fixture expectations
  if (fx.name.startsWith('Solo + bootstrapping')) {
    expect(
      'no cofounder_walkout_named (gated on team=named)',
      !ids.includes('cofounder_walkout_named'),
      `picked: ${ids.join(', ')}`,
    )
    expect(
      'no vc_term_sheet_thiel (no cameo supplied)',
      !ids.includes('vc_term_sheet_thiel'),
      `picked: ${ids.join(', ')}`,
    )
    expect(
      'no vc_term_sheet_marc (no cameo supplied)',
      !ids.includes('vc_term_sheet_marc'),
      `picked: ${ids.join(', ')}`,
    )
    expect(
      'solo_yc_recruit eligible (team=solo)',
      ids.includes('solo_yc_recruit'),
      `picked: ${ids.join(', ')}`,
    )
    expect(
      'episode 0 → no late-tier (mentor_gut_punch)',
      !ids.includes('mentor_gut_punch'),
      `picked: ${ids.join(', ')}`,
    )
  }

  if (fx.name.startsWith('Named cofounder + raising')) {
    expect(
      'no solo_yc_recruit (team=named)',
      !ids.includes('solo_yc_recruit'),
      `picked: ${ids.join(', ')}`,
    )
  }

  if (fx.name.startsWith('Raising + Thiel cameo')) {
    expect(
      'vc_term_sheet_thiel eligible (cameo + funding=raising + episode 1)',
      ids.includes('vc_term_sheet_thiel'),
      `picked: ${ids.join(', ')}`,
    )
    expect(
      'mentor_pg_essay eligible (paul-graham cameo + episode 1)',
      ids.includes('mentor_pg_essay'),
      `picked: ${ids.join(', ')}`,
    )
  }

  if (fx.name.startsWith('High hype + Altman cameo')) {
    expect(
      'mentor_altman_blessing fires (cameo + hype>=3)',
      ids.includes('mentor_altman_blessing'),
      `picked: ${ids.join(', ')}`,
    )
  }

  if (fx.name.startsWith('Late-game crisis')) {
    expect(
      'late tier unlocked (mentor_gut_punch eligible at episode 3)',
      // note: it requires hype>=2 + integrity<=0, both satisfied
      ids.includes('mentor_gut_punch'),
      `picked: ${ids.join(', ')}`,
    )
    // At late-game extremes, MANY storylets become eligible at the
    // same specificity score (0.5). The 5 slots can't fit all of them
    // — hash tiebreak picks the order. Don't assert a SPECIFIC storylet
    // wins; assert the engine produces a varied late-game crisis with
    // at least one solo + at least one specific cofounder/mentor beat.
    expect(
      'late-crisis episode includes at least one solo storylet',
      storylets.some((s) => s.kind === 'solo'),
      `picked kinds: ${storylets.map((s) => s.kind ?? 'encounter').join(', ')}`,
    )
    expect(
      'no generic-empty-requires storylet wins when specific ones are eligible',
      // At least 4 of 5 picks must have non-empty requires (specificity)
      storylets.filter((s) => Object.keys(s.requires).length > 0).length >= 4,
      `picked: ${ids.join(', ')}`,
    )
  }

  if (fx.name.startsWith('Non-encounter mix')) {
    expect(
      'at least one non-encounter storylet picked (kind != encounter)',
      storylets.some((s) => s.kind === 'solo' || s.kind === 'world-event'),
      `picked kinds: ${storylets.map((s) => s.kind ?? 'encounter').join(', ')}`,
    )
  }

  if (fx.name.startsWith('High-hype world-event')) {
    expect(
      'world_viral_tweet_aftermath eligible (hype>=3 + episode 1)',
      ids.includes('world_viral_tweet_aftermath'),
      `picked: ${ids.join(', ')}`,
    )
    // world_competitor_launches and world_x_account_locked tie on score
    // and the hash-tiebreak picks one — assert at least one fires.
    expect(
      'at least 2 non-encounter storylets in this hype-saturated episode',
      storylets.filter((s) => s.kind === 'solo' || s.kind === 'world-event')
        .length >= 2,
      `picked kinds: ${storylets.map((s) => s.kind ?? 'encounter').join(', ')}`,
    )
  }

  if (fx.name.startsWith('Cooldown check')) {
    expect(
      'vc_cold_pitch_generic suppressed (fired in ep0, default cooldown=2)',
      !ids.includes('vc_cold_pitch_generic'),
      `picked: ${ids.join(', ')}`,
    )
    expect(
      'mentor_generic_advice suppressed (fired in ep0)',
      !ids.includes('mentor_generic_advice'),
      `picked: ${ids.join(', ')}`,
    )
  }
}

console.log()
if (failures === 0) {
  console.log(`${GREEN}${BOLD}All assertions passed.${RESET}`)
} else {
  console.log(`${RED}${BOLD}${failures} assertion(s) failed.${RESET}`)
  process.exit(1)
}
