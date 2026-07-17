// SPEC-GENERATOR §1–4 — the generation pipeline (minus the layout pass, which
// is Phase 2). Rejection sampling is the honest architecture: generation is
// cheap, so reject freely rather than build clever repair logic. All randomness
// flows from one seeded PRNG; every emitted puzzle is reproducible from its seed.
//
// DEBT (tracked): the §2.1/§2.6 layout-budget rejection ("difficulty ≠ density")
// is stubbed here with a crude degree/density guard. Real force-directed layout
// legibility rejection lands with render/ in Phase 2.

import {
  CType,
  FORMAT_VERSION,
  threadsOf,
  type Constraint,
  type DifficultyVector,
  type Puzzle,
} from "../core/types.js";
import { solve, type SolveResult } from "../solver/index.js";
import { isUnique } from "./dpll.js";
import { grade, tierBandOf } from "./grade.js";
import { Rng } from "./rng.js";

export type TargetTier = 1 | 2 | 3 | 4;

export interface GenRequest {
  targetTier: TargetTier;
  targetSteps: [min: number, max: number];
  threadCount: [min: number, max: number];
  /** Optional per-type weight overrides for constraint assignment. */
  constraintMix?: Partial<Record<CType, number>>;
}

export type RejectReason =
  | "not_unique"
  | "not_deducible"
  | "needs_r5"
  | "too_easy_t4"
  | "off_band"
  | "off_steps"
  | "layout_density";

export interface GenOk {
  ok: true;
  puzzle: Puzzle;
  certificate: string;
  solve: SolveResult;
  seed: number;
}
export interface GenRejected {
  ok: false;
  reason: RejectReason;
  seed: number;
}
export type GenAttempt = GenOk | GenRejected;

// Verification ceiling per target tier. Tier 3 verifies like tier 2 (counting,
// no hypotheticals); it is distinguished from tier 2 by scalar, not rule set.
function ceilingFor(t: TargetTier): 1 | 2 | 3 | 4 {
  return t;
}

// ── topology priors per tier (SPEC-GENERATOR §2.1) ───────────────────────────
// Tuned for ≥5% acceptance; adjust these priors (not the verifier) if a band
// falls below target.

interface Prior {
  extraEdgeFactor: number; // extra binary edges ≈ factor · n, atop the spanning tree
  countClusters: [min: number, max: number]; // COUNT_* hyperedges
  binaryWeights: Record<CType, number>; // weights over binary types
  maxDegree: number; // layout-density stub: reject threads above this degree
  anchors: number; // initial ANCHOR count (repair may add one more, tiers 1–3)
}

const BIN = (impl: number, xor: number, nand: number, or: number, equiv: number): Record<CType, number> => ({
  [CType.ANCHOR]: 0,
  [CType.IMPL]: impl,
  [CType.XOR]: xor,
  [CType.NAND]: nand,
  [CType.OR]: or,
  [CType.EQUIV]: equiv,
  [CType.COUNT_EQ]: 0,
  [CType.COUNT_LE]: 0,
  [CType.COUNT_GE]: 0,
});

const PRIORS: Record<TargetTier, Prior> = {
  // T1: strong-forcing binaries (XOR/EQUIV), no counting, one anchor.
  1: { extraEdgeFactor: 0.15, countClusters: [0, 0], binaryWeights: BIN(2, 3, 1, 1, 3), maxDegree: 6, anchors: 1 },
  // T2: mixed binaries + a little counting — the Daily Knot band.
  2: { extraEdgeFactor: 0.35, countClusters: [1, 3], binaryWeights: BIN(3, 2, 2, 2, 2), maxDegree: 7, anchors: 1 },
  // T3: larger, chain- and counting-heavy; still no hypotheticals. Higher degree
  // cap so the density needed for uniqueness at this size survives the stub.
  3: { extraEdgeFactor: 0.5, countClusters: [2, 5], binaryWeights: BIN(3, 2, 2, 2, 2), maxDegree: 9, anchors: 1 },
  // T4: balanced binaries (OR/NAND stall tier≤2 propagation; IMPL/XOR/EQUIV pin
  // structure) plus 1–2 COUNT clusters. Counts are the strongest uniqueness
  // lever — they cut the model space hard while the weak binaries keep a
  // depth-1 hypothesis (R4.1) necessary. too_easy_t4 drops any that ends up
  // tier≤2-solvable. Low acceptance by nature.
  4: { extraEdgeFactor: 0.65, countClusters: [2, 3], binaryWeights: BIN(2, 2, 3, 3, 1), maxDegree: 9, anchors: 1 },
};

// ── topology + assignment ────────────────────────────────────────────────────

interface Edge {
  a: number;
  b: number;
}

function sampleTopology(rng: Rng, n: number, prior: Prior): { edges: Edge[]; clusters: number[][] } {
  const order = rng.shuffle([...Array(n).keys()]);
  const edges: Edge[] = [];
  const seen = new Set<number>();
  const key = (a: number, b: number) => (a < b ? a * 64 + b : b * 64 + a);

  // Spanning tree guarantees connectivity.
  for (let i = 1; i < n; i++) {
    const a = order[i]!;
    const b = order[rng.int(i)]!;
    edges.push({ a, b });
    seen.add(key(a, b));
  }
  // Extra binary edges up to the density target.
  const extra = Math.round(prior.extraEdgeFactor * n);
  for (let attempts = 0, added = 0; added < extra && attempts < extra * 8; attempts++) {
    const a = rng.int(n);
    const b = rng.int(n);
    if (a === b || seen.has(key(a, b))) continue;
    edges.push({ a, b });
    seen.add(key(a, b));
    added++;
  }
  // COUNT_* clusters over small random subsets.
  const nClusters = n >= 3 ? rng.range(prior.countClusters[0], prior.countClusters[1]) : 0;
  const clusters: number[][] = [];
  for (let c = 0; c < nClusters; c++) {
    const size = Math.min(n, rng.range(3, 5));
    const pool = rng.shuffle([...Array(n).keys()]).slice(0, size);
    clusters.push(pool);
  }
  return { edges, clusters };
}

/** Choose a binary constraint type + orientation consistent with assignment A. */
function assignBinary(rng: Rng, a: number, b: number, A: Uint8Array, weights: Record<CType, number>): Constraint {
  const va = A[a]!;
  const vb = A[b]!;
  const candidates: { c: Constraint; w: number }[] = [];
  const add = (type: CType, w: number, threads: number[]) => {
    if (w > 0) candidates.push({ c: { type, threads }, w });
  };
  // IMPL: pick a consistent direction (a→b unless that's the false case).
  if (!(va === 1 && vb === 0)) add(CType.IMPL, weights[CType.IMPL]!, [a, b]);
  else add(CType.IMPL, weights[CType.IMPL]!, [b, a]);
  if (va !== vb) add(CType.XOR, weights[CType.XOR]!, [a, b]);
  if (!(va === 1 && vb === 1)) add(CType.NAND, weights[CType.NAND]!, [a, b]);
  if (va === 1 || vb === 1) add(CType.OR, weights[CType.OR]!, [a, b]);
  if (va === vb) add(CType.EQUIV, weights[CType.EQUIV]!, [a, b]);

  if (candidates.length === 0) add(CType.IMPL, 1, va === 1 && vb === 0 ? [b, a] : [a, b]);
  const idx = rng.weightedIndex(candidates.map((x) => x.w));
  return candidates[idx]!.c;
}

/** Choose a COUNT_* constraint over subset S at the boundary implied by A. */
function assignCount(rng: Rng, S: number[], A: Uint8Array): Constraint {
  let nT = 0;
  for (const t of S) nT += A[t]!;
  // Mostly COUNT_EQ (forces both directions); occasional LE/GE at the boundary.
  const roll = rng.float();
  if (roll < 0.7 || nT === 0 || nT === S.length) {
    return { type: CType.COUNT_EQ, threads: S, k: nT };
  }
  return roll < 0.85
    ? { type: CType.COUNT_LE, threads: S, k: nT }
    : { type: CType.COUNT_GE, threads: S, k: nT };
}

function solutionMask(A: Uint8Array): bigint {
  let m = 0n;
  for (let i = 0; i < A.length; i++) if (A[i] === 1) m |= 1n << BigInt(i);
  return m;
}

// ── layout-density stub (SPEC-GENERATOR §2.1 debt) ───────────────────────────

function layoutDensityOk(n: number, constraints: readonly Constraint[], prior: Prior): boolean {
  const degree = new Int32Array(n);
  for (const c of constraints) if (c.type !== CType.ANCHOR) for (const t of c.threads) degree[t]!++;
  for (let i = 0; i < n; i++) if (degree[i]! > prior.maxDegree) return false;
  return true;
}

// ── one attempt ──────────────────────────────────────────────────────────────

export function generateOne(seed: number, req: GenRequest): GenAttempt {
  const rng = new Rng(seed);
  const prior = PRIORS[req.targetTier];
  const weights = { ...prior.binaryWeights, ...req.constraintMix };
  const n = rng.range(req.threadCount[0], req.threadCount[1]);

  const A = new Uint8Array(n);
  for (let i = 0; i < n; i++) A[i] = rng.bool() ? 1 : 0;

  const { edges, clusters } = sampleTopology(rng, n, prior);
  const constraints: Constraint[] = [];
  for (const e of edges) constraints.push(assignBinary(rng, e.a, e.b, A, weights));
  for (const S of clusters) constraints.push(assignCount(rng, S, A));

  // Initial anchors (§2.2). Fewer anchors = tighter puzzle; place distinct ones.
  const anchorPool = rng.shuffle([...Array(n).keys()]);
  const nAnchors = Math.min(prior.anchors, n);
  for (let i = 0; i < nAnchors; i++) {
    const t = anchorPool[i]!;
    constraints.push({ type: CType.ANCHOR, threads: [t], k: A[t]! });
  }

  if (!layoutDensityOk(n, constraints, prior)) return { ok: false, reason: "layout_density", seed };

  // Uniqueness (§2.3). Reject rather than repair — adding anchors skews difficulty.
  if (!isUnique(n, constraints)) return { ok: false, reason: "not_unique", seed };

  const ceiling = ceilingFor(req.targetTier);
  let result = solve(n, constraints, { tierCeiling: ceiling });

  // Deducibility verification + one-round anchor repair (§3.3). Skip repair for
  // T4: adding an anchor tends to dissolve the hypothetical necessity.
  if (!result.solved) {
    if (result.needsDeeper && req.targetTier === 4) return { ok: false, reason: "needs_r5", seed };
    if (req.targetTier !== 4) {
      const repaired = repairAnchor(n, constraints, A, ceiling);
      if (repaired) {
        constraints.push(repaired);
        result = solve(n, constraints, { tierCeiling: ceiling });
      }
    }
    if (!result.solved) {
      return { ok: false, reason: result.needsDeeper ? "needs_r5" : "not_deducible", seed };
    }
  }

  const difficulty: DifficultyVector = grade(result, constraints, n);

  // T4 must genuinely require a hypothetical; otherwise it is a mislabeled T≤3.
  if (req.targetTier === 4 && difficulty.hypoCount < 1) return { ok: false, reason: "too_easy_t4", seed };

  if (tierBandOf(difficulty.scalar) !== req.targetTier) return { ok: false, reason: "off_band", seed };
  if (difficulty.steps < req.targetSteps[0] || difficulty.steps > req.targetSteps[1]) {
    return { ok: false, reason: "off_steps", seed };
  }

  const puzzle: Puzzle = {
    formatVersion: FORMAT_VERSION,
    threads: threadsOf(n),
    constraints,
    solution: solutionMask(A),
    difficulty,
    layoutSeed: seed, // Phase 1: gen seed doubles as the (deferred) layout seed
    contentTableRef: "symbolic",
  };
  return { ok: true, puzzle, certificate: result.certificate, solve: result, seed };
}

/** Find the single anchor whose forced value unlocks the longest cascade (§3.3). */
function repairAnchor(n: number, constraints: Constraint[], A: Uint8Array, ceiling: 1 | 2 | 3 | 4): Constraint | null {
  const base = solve(n, constraints, { tierCeiling: ceiling });
  let best: { thread: number; known: number } | null = null;
  for (let t = 0; t < n; t++) {
    if (base.value[t]! !== -1) continue; // already determined
    const trial: Constraint[] = [...constraints, { type: CType.ANCHOR, threads: [t], k: A[t]! }];
    const r = solve(n, trial, { tierCeiling: ceiling });
    let known = 0;
    for (let i = 0; i < n; i++) if (r.value[i]! !== -1) known++;
    if (best === null || known > best.known) best = { thread: t, known };
  }
  if (best === null) return null;
  return { type: CType.ANCHOR, threads: [best.thread], k: A[best.thread]! };
}
