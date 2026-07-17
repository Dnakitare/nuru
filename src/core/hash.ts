// SPEC-CORE §6 — canonical graph hash. The puzzle digest is SHA-256 over a
// canonical serialization: constraints sorted by (type, sorted threadIds, k),
// with thread ids renumbered by first appearance in that sorted order. This
// makes the digest independent of authoring order and of monotonic thread-id
// relabeling (shifts/gaps).
//
// Honest limitation: this is NOT full graph-isomorphism invariance — an
// arbitrary permutation of thread labels yields a different digest. That is
// fine for the stated purpose (the shared Daily Knot is the identical puzzle
// object for everyone, so digests match trivially; sigils are stable across
// re-emission and label shifts). Do not lean on it for dedup of independently
// authored isomorphic puzzles.

import { sha256, toHex } from "./sha256.js";
import { metaFor, type Constraint } from "./types.js";

interface Keyed {
  c: Constraint;
  sortedThreads: number[];
}

function compare(a: Keyed, b: Keyed): number {
  if (a.c.type !== b.c.type) return a.c.type - b.c.type;
  const la = a.sortedThreads;
  const lb = b.sortedThreads;
  const n = Math.min(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i]! !== lb[i]!) return la[i]! - lb[i]!;
  }
  if (la.length !== lb.length) return la.length - lb.length;
  return (a.c.k ?? -1) - (b.c.k ?? -1);
}

/**
 * Canonical byte serialization of a constraint graph. threadCount is included
 * so puzzles differing only in isolated-thread count still differ.
 */
export function canonicalBytes(threadCount: number, constraints: readonly Constraint[]): Uint8Array {
  const keyed: Keyed[] = constraints.map((c) => ({
    c,
    sortedThreads: [...c.threads].sort((x, y) => x - y),
  }));
  keyed.sort(compare);

  // Renumber by first appearance, scanning each constraint's threads in
  // ORIGINAL order so directional types (IMPL, ANCHOR) keep their orientation.
  const remap = new Map<number, number>();
  let next = 0;
  for (const { c } of keyed) {
    for (const t of c.threads) {
      if (!remap.has(t)) remap.set(t, next++);
    }
  }

  const out: number[] = [threadCount & 0xff, keyed.length & 0xff];
  for (const { c } of keyed) {
    const meta = metaFor(c.type);
    out.push(c.type, c.threads.length);
    for (const t of c.threads) out.push(remap.get(t)!);
    if (meta.hasK) out.push((c.k ?? 0) & 0xff);
  }
  return Uint8Array.from(out);
}

/** 32-byte canonical digest of a puzzle graph. */
export function puzzleDigest(threadCount: number, constraints: readonly Constraint[]): Uint8Array {
  return sha256(canonicalBytes(threadCount, constraints));
}

export function puzzleDigestHex(threadCount: number, constraints: readonly Constraint[]): string {
  return toHex(puzzleDigest(threadCount, constraints));
}
