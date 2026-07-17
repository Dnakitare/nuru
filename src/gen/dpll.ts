// SPEC-GENERATOR §2.3 — model counting for the uniqueness check. DPLL-style:
// unit-propagate via the solver's sound propagation, branch on the first
// unassigned thread, count satisfying assignments with an early exit at the
// limit (uniqueness only needs to know count is exactly 1, i.e. not 0 and not
// ≥2). No SAT-library dependency; COUNT_* are handled by direct propagation,
// never CNF expansion.

import { firstViolated, propagate } from "../solver/index.js";
import type { Constraint } from "../core/types.js";

const U = -1;

/**
 * Count satisfying assignments, stopping once `limit` is reached. Returns
 * min(actualCount, limit).
 */
export function countModels(threadCount: number, constraints: readonly Constraint[], limit = 2): number {
  let count = 0;
  const start = new Int8Array(threadCount).fill(U);

  const rec = (s: Int8Array): void => {
    if (count >= limit) return;
    propagate(constraints, s);
    if (firstViolated(constraints, s) !== -1) return; // dead branch

    let pivot = -1;
    for (let i = 0; i < threadCount; i++) {
      if (s[i] === U) {
        pivot = i;
        break;
      }
    }
    if (pivot === -1) {
      count++; // fully assigned and consistent
      return;
    }
    // Branch. Copy so propagation on one value doesn't leak into the other.
    const a = s.slice();
    a[pivot] = 0;
    rec(a);
    if (count >= limit) return;
    const b = s.slice();
    b[pivot] = 1;
    rec(b);
  };

  rec(start);
  return count;
}

/** Convenience: exactly one satisfying assignment. */
export function isUnique(threadCount: number, constraints: readonly Constraint[]): boolean {
  return countModels(threadCount, constraints, 2) === 1;
}
