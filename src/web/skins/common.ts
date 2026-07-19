// Shared builder for the alternate skins. Both minesweeper and the grid game are
// just constraint graphs over the SAME verified engine: the solver decides
// deducibility, firstViolated localizes contradictions, grade scores difficulty.
// Only the topology (how the graph is shaped) and the render/input change.
//
// The construction trick is uniform: start from a chosen solution + the skin's
// fixed rules, then greedily reveal "clue" bundles until the deduction solver
// fully solves the board. A fully-solved board is uniquely determined by
// construction, so the puzzle is unique AND requires no guessing — which is the
// whole pitch. Then thin redundant clues for elegance.

import type { Constraint } from "../../core/index.js";
import { firstViolated, solve } from "../../solver/index.js";

const U = -1;

export interface Built {
  constraints: Constraint[];
  keptClues: number[]; // indices into the input bundles that survived thinning
}

function solves(threadCount: number, cs: Constraint[]): boolean {
  return solve(threadCount, cs, { tierCeiling: 4 }).solved;
}

/**
 * Reveal clue bundles (in the given order) until the board fully solves, then
 * drop any clue the solve no longer needs. Returns null if even every clue
 * leaves it unsolvable (caller should resample the solution).
 */
export function greedyReveal(threadCount: number, rules: Constraint[], bundles: Constraint[][]): Built | null {
  const kept: number[] = [];
  const flat = (): Constraint[] => [...rules, ...kept.flatMap((i) => bundles[i]!)];

  if (!solves(threadCount, flat())) {
    for (let i = 0; i < bundles.length; i++) {
      kept.push(i);
      if (solves(threadCount, flat())) break;
    }
    if (!solves(threadCount, flat())) return null;
  }
  // thin: remove any clue the board can still be solved without
  for (let j = kept.length - 1; j >= 0; j--) {
    const trial = kept.filter((_, k) => k !== j);
    if (solves(threadCount, [...rules, ...trial.flatMap((i) => bundles[i]!)])) kept.splice(j, 1);
  }
  return { constraints: flat(), keptClues: kept };
}

export interface Eval {
  derived: Int8Array; // = committed (player does the deducing)
  violated: number; // constraint index or -1
  solved: boolean;
  unknownCount: number;
}

/** Evaluate a player's partial assignment against the puzzle's constraints. */
export function evaluate(threadCount: number, constraints: readonly Constraint[], committed: Int8Array): Eval {
  const violated = firstViolated(constraints, committed);
  let unknownCount = 0;
  for (let i = 0; i < threadCount; i++) if (committed[i] === U) unknownCount++;
  return { derived: committed, violated, solved: unknownCount === 0 && violated === -1, unknownCount };
}

export function bit(mask: bigint, i: number): 0 | 1 {
  return Number((mask >> BigInt(i)) & 1n) as 0 | 1;
}
