// SPEC-GENERATOR §4 — grading. The DifficultyVector is computed from the
// canonical solve trace; it is theory until the Phase 1 human-anchoring gate
// (§4.2) confirms Spearman(scalar, solve time) ≥ 0.7. Only §4.3 weights are
// tunable — never the rule taxonomy, never the vector field set.

import type { DifficultyVector } from "../core/types.js";
import type { SolveResult, Step } from "../solver/index.js";
import { Rule } from "../solver/index.js";

/** §4.3 scalar-composite weights. The single tunable knob; frozen fields feed it. */
export const WEIGHTS = {
  maxTier: 1.0,
  steps: 0.05,
  maxChain: 0.3,
  tightness: 0.5, // multiplies (1/minWidth)·maxTier
  hypoCount: 1.5,
} as const;

/** §4.4 tier bands over the scalar (provisional; confirm at the Phase 1 gate). */
export const TIER_BANDS = { t1: 3, t2: 6, t3: 10 } as const;

export function tierBandOf(scalar: number): 1 | 2 | 3 | 4 {
  if (scalar < TIER_BANDS.t1) return 1;
  if (scalar < TIER_BANDS.t2) return 2;
  if (scalar < TIER_BANDS.t3) return 3;
  return 4;
}

/**
 * Longest forced dependency chain (§4.1): step B depends on step A if A's
 * concluded thread appears in B's triggering constraint. R0 (given) steps are
 * roots. R4 (hypothetical) steps sit atop all prior reasoning, so their depth
 * is one past the deepest step so far.
 */
function longestChain(trace: readonly Step[], constraints: readonly { threads: readonly number[] }[]): number {
  const depth = new Array<number>(trace.length).fill(0);
  const concludedBy = new Map<number, number>(); // thread → step index
  let maxSoFar = 0;
  let best = 0;

  for (let i = 0; i < trace.length; i++) {
    const st = trace[i]!;
    let d = 1;
    if (st.constraint === -1) {
      // Hypothetical: depends on the whole chain built so far.
      d = maxSoFar + 1;
    } else {
      const triggers = constraints[st.constraint]!.threads;
      for (const t of triggers) {
        if (t === st.thread) continue;
        const src = concludedBy.get(t);
        if (src !== undefined) d = Math.max(d, depth[src]! + 1);
      }
    }
    depth[i] = d;
    if (d > maxSoFar) maxSoFar = d;
    if (d > best) best = d;
    concludedBy.set(st.thread, i);
  }
  return best;
}

export function grade(
  result: SolveResult,
  constraints: readonly { threads: readonly number[] }[],
  threadCount: number,
): DifficultyVector {
  const trace = result.trace;
  let maxTier = 0;
  let hypoCount = 0;
  for (const st of trace) {
    if (st.tier > maxTier) maxTier = st.tier;
    if (st.rule === Rule.R4_1) hypoCount++;
  }
  // A well-formed puzzle always requires ≥1 inference; clamp so an all-anchor
  // degenerate trace still reports a floor tier of 1.
  if (maxTier < 1) maxTier = 1;

  const steps = trace.length;
  const maxChain = longestChain(trace, constraints);

  // minWidth over genuine inference steps (tier ≥ 1); anchors aren't choices.
  let minWidth = Infinity;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i]!.tier >= 1) {
      const w = result.widths[i] ?? 1;
      if (w < minWidth) minWidth = w;
    }
  }
  if (!Number.isFinite(minWidth) || minWidth < 1) minWidth = 1;

  const scalar =
    WEIGHTS.maxTier * maxTier +
    WEIGHTS.steps * steps +
    WEIGHTS.maxChain * maxChain +
    WEIGHTS.tightness * (1 / minWidth) * maxTier +
    WEIGHTS.hypoCount * hypoCount;

  return {
    maxTier,
    steps,
    maxChain,
    minWidth,
    hypoCount,
    threadCount,
    scalar: Math.round(scalar * 1000) / 1000,
  };
}
