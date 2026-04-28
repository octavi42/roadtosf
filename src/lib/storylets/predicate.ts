import type { SelectionState, StoryletRequires } from './types'

// Walks the predicate object key-by-key with AND semantics, short-
// circuiting on the first mismatch. Missing keys are unconstrained.
// Cameo and tone keys evaluate false (not unconstrained) when the run
// state lacks those fields — that's the graceful-degradation hook for
// shipping the storylet engine before PR #23 lands.
export function evaluateRequires(
  requires: StoryletRequires,
  state: SelectionState,
): boolean {
  if (requires.hypeGte !== undefined && state.hype < requires.hypeGte) return false
  if (requires.hypeLte !== undefined && state.hype > requires.hypeLte) return false
  if (
    requires.integrityGte !== undefined &&
    state.integrity < requires.integrityGte
  ) {
    return false
  }
  if (
    requires.integrityLte !== undefined &&
    state.integrity > requires.integrityLte
  ) {
    return false
  }
  if (requires.team !== undefined && state.team !== requires.team) return false
  if (requires.funding !== undefined && state.funding !== requires.funding) {
    return false
  }
  if (
    requires.flagSet !== undefined &&
    !state.storyletState.flags[requires.flagSet]
  ) {
    return false
  }
  if (
    requires.flagNotSet !== undefined &&
    state.storyletState.flags[requires.flagNotSet] === true
  ) {
    return false
  }
  if (requires.cameo !== undefined) {
    if (!state.rolledCameos || !state.rolledCameos.includes(requires.cameo)) {
      return false
    }
  }
  if (requires.tone !== undefined) {
    if (!state.tone || state.tone !== requires.tone) return false
  }
  if (requires.flavorTag !== undefined) {
    if (!state.flavorTags.map((t) => t.toLowerCase()).includes(requires.flavorTag.toLowerCase())) {
      return false
    }
  }
  if (
    requires.firedCountGte !== undefined &&
    state.storyletState.fired.length < requires.firedCountGte
  ) {
    return false
  }
  return true
}
