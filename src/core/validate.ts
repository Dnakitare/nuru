// SPEC-CORE §1.3 well-formedness — the STRUCTURAL half (connectivity, anchor
// presence, thread coverage, id/arity sanity). Uniqueness and deducibility are
// checked separately by the solver/DPLL (see cli `verify`), because those pull
// in solver/gen; this stays dependency-free in core/ so any decoder can run it.
//
// A decoded shared puzzle is untrusted input once share links exist (Phase 2+),
// so verify should run this before treating a payload as a real puzzle.

import { CType, metaFor, type Constraint } from "./types.js";

/** Returns a list of well-formedness problems; empty means structurally valid. */
export function validateStructure(threadCount: number, constraints: readonly Constraint[]): string[] {
  const problems: string[] = [];
  if (threadCount <= 0) return ["puzzle has no threads"];

  // id + arity sanity (decode already enforces most, but validate defensively)
  for (let ci = 0; ci < constraints.length; ci++) {
    const c = constraints[ci]!;
    const meta = metaFor(c.type);
    if (c.threads.length < meta.minArity || c.threads.length > meta.maxArity) {
      problems.push(`constraint ${ci} (${meta.name}) arity ${c.threads.length} outside [${meta.minArity},${meta.maxArity}]`);
    }
    for (const t of c.threads) {
      if (!Number.isInteger(t) || t < 0 || t >= threadCount) problems.push(`constraint ${ci} references thread ${t} out of range`);
    }
  }

  // ≥1 ANCHOR (the pull-in point for deduction)
  const anchors = constraints.filter((c) => c.type === CType.ANCHOR).length;
  if (anchors < 1) problems.push("no ANCHOR constraint (deduction has no starting point)");

  // every thread appears in ≥1 non-ANCHOR constraint
  const inNonAnchor = new Array<boolean>(threadCount).fill(false);
  for (const c of constraints) {
    if (c.type === CType.ANCHOR) continue;
    for (const t of c.threads) if (t >= 0 && t < threadCount) inNonAnchor[t] = true;
  }
  const orphans = [];
  for (let t = 0; t < threadCount; t++) if (!inNonAnchor[t]) orphans.push(t);
  if (orphans.length) problems.push(`threads not in any non-ANCHOR constraint: ${orphans.join(", ")}`);

  // connectivity over non-ANCHOR constraints (one knot, not several)
  if (!isConnected(threadCount, constraints)) problems.push("constraint graph is not connected (multiple knots)");

  return problems;
}

function isConnected(n: number, constraints: readonly Constraint[]): boolean {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[x] !== r) {
      const next = parent[x]!;
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  for (const c of constraints) {
    if (c.type === CType.ANCHOR) continue;
    for (let i = 1; i < c.threads.length; i++) union(c.threads[0]!, c.threads[i]!);
  }
  const root = find(0);
  for (let t = 1; t < n; t++) if (find(t) !== root) return false;
  return true;
}
