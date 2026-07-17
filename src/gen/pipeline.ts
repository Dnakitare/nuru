// Rejection-sampling search + the Phase 1 batch gate (SPEC-GENERATOR §1, §5).
// generate() draws independent sub-seeds until a puzzle is accepted, so the
// emitted puzzle is reproducible from its own seed in a single attempt.

import { decodePuzzle, encodePuzzle } from "../core/wire.js";
import { threadsOf, type Puzzle } from "../core/types.js";
import { solve } from "../solver/index.js";
import { isUnique } from "./dpll.js";
import { generateOne, type GenRequest, type RejectReason, type TargetTier } from "./generator.js";
import { mixSeed } from "./rng.js";

export interface GenResult {
  ok: true;
  puzzle: Puzzle;
  certificate: string;
  seed: number;
  attempts: number;
}
export interface GenFailure {
  ok: false;
  attempts: number;
  reasons: Record<string, number>;
}

export function generate(req: GenRequest, baseSeed: number, maxAttempts = 4000): GenResult | GenFailure {
  const reasons: Record<string, number> = {};
  for (let i = 0; i < maxAttempts; i++) {
    const seed = mixSeed(baseSeed, i);
    const a = generateOne(seed, req);
    if (a.ok) return { ok: true, puzzle: a.puzzle, certificate: a.certificate, seed: a.seed, attempts: i + 1 };
    reasons[a.reason] = (reasons[a.reason] ?? 0) + 1;
  }
  return { ok: false, attempts: maxAttempts, reasons };
}

/** The difficulty ladder used by `fumbo batch --ladder`. Provisional ranges. */
export const LADDER: Record<TargetTier, GenRequest> = {
  1: { targetTier: 1, targetSteps: [3, 12], threadCount: [4, 7] },
  2: { targetTier: 2, targetSteps: [5, 18], threadCount: [7, 11] },
  3: { targetTier: 3, targetSteps: [10, 34], threadCount: [10, 16] },
  4: { targetTier: 4, targetSteps: [5, 34], threadCount: [7, 13] },
};

export interface BandReport {
  tier: TargetTier;
  requested: number;
  accepted: number;
  totalAttempts: number;
  acceptanceRate: number;
  rejectReasons: Record<string, number>;
  scalar: { min: number; max: number; mean: number };
  bandHistogram: Record<number, number>; // scalar-band → count
  verifyFailures: number;
}

export interface BatchReport {
  bands: BandReport[];
  totalPuzzles: number;
  totalMs: number;
  uniquenessPass: boolean;
  deducibilityPass: boolean;
  zeroR5: boolean;
  acceptancePass: boolean;
  allBandsPopulated: boolean;
  wireRoundTripPass: boolean;
}

/**
 * Independently re-verify an emitted puzzle: wire round-trip byte-identity,
 * uniqueness, and a re-solve whose certificate matches. This is the check the
 * CLI `verify` command runs; the batch runs it on every accepted puzzle.
 */
export function verifyPuzzle(puzzle: Puzzle, certificate: string, tier: TargetTier): boolean {
  const s1 = encodePuzzle({ threadCount: puzzle.threads.length, layoutSeed: puzzle.layoutSeed, constraints: puzzle.constraints, solution: puzzle.solution }, { includeSolution: true });
  const dec = decodePuzzle(s1);
  const s2 = encodePuzzle(dec, { includeSolution: true });
  if (s1 !== s2) return false;
  if (!isUnique(dec.threadCount, dec.constraints)) return false;
  const re = solve(dec.threadCount, dec.constraints, { tierCeiling: tier });
  if (!re.solved || re.certificate !== certificate) return false;
  // solution must match the model
  const threads = threadsOf(dec.threadCount);
  for (const t of threads) {
    const bit = Number((puzzle.solution >> BigInt(t.id)) & 1n);
    if (re.value[t.id] !== bit) return false;
  }
  return true;
}

export function runBatch(perBand: number, baseSeed: number): BatchReport {
  const startMs = performanceNow();
  const bands: BandReport[] = [];
  let zeroR5 = true;
  let deducibilityPass = true;
  let wireRoundTripPass = true;

  for (const tier of [1, 2, 3, 4] as TargetTier[]) {
    const req = LADDER[tier];
    let accepted = 0;
    let totalAttempts = 0;
    const rejectReasons: Record<string, number> = {};
    const scalars: number[] = [];
    const bandHistogram: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let verifyFailures = 0;

    let bandSeed = mixSeed(baseSeed, tier * 1_000_003);
    while (accepted < perBand) {
      const r = generate(req, bandSeed, 6000);
      totalAttempts += r.attempts;
      if (!r.ok) {
        for (const [k, v] of Object.entries(r.reasons)) rejectReasons[k] = (rejectReasons[k] ?? 0) + v;
        break; // could not fill the band within the attempt budget
      }
      // Fold rejects observed on the way to this acceptance into totals.
      accepted++;
      scalars.push(r.puzzle.difficulty.scalar);
      bandHistogram[r.puzzle.difficulty.scalar < 3 ? 1 : r.puzzle.difficulty.scalar < 6 ? 2 : r.puzzle.difficulty.scalar < 10 ? 3 : 4]!++;
      if (!verifyPuzzle(r.puzzle, r.certificate, tier)) {
        verifyFailures++;
        deducibilityPass = false;
        wireRoundTripPass = false;
      }
      if (r.puzzle.difficulty.hypoCount > 0 && tier !== 4) zeroR5 = false; // sanity
      bandSeed = mixSeed(bandSeed, r.attempts + 7);
    }

    const min = scalars.length ? Math.min(...scalars) : 0;
    const max = scalars.length ? Math.max(...scalars) : 0;
    const mean = scalars.length ? scalars.reduce((a, b) => a + b, 0) / scalars.length : 0;
    bands.push({
      tier,
      requested: perBand,
      accepted,
      totalAttempts,
      acceptanceRate: totalAttempts ? accepted / totalAttempts : 0,
      rejectReasons,
      scalar: { min: round(min), max: round(max), mean: round(mean) },
      bandHistogram,
      verifyFailures,
    });
  }

  const totalPuzzles = bands.reduce((a, b) => a + b.accepted, 0);
  const acceptancePass = bands.every((b) => b.acceptanceRate >= 0.05);
  const allBandsPopulated = bands.every((b) => b.accepted > 0);
  const uniquenessPass = bands.every((b) => b.verifyFailures === 0);

  return {
    bands,
    totalPuzzles,
    totalMs: Math.round(performanceNow() - startMs),
    uniquenessPass,
    deducibilityPass,
    zeroR5,
    acceptancePass,
    allBandsPopulated,
    wireRoundTripPass,
  };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function performanceNow(): number {
  // Available in Node and browser; avoids Date.now for portability.
  return typeof performance !== "undefined" ? performance.now() : 0;
}
