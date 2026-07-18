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
  p95Ms: number; // per-puzzle gen+verify p95 (§GENERATOR 6 budget: <50ms)
  uniquenessPass: boolean;
  deducibilityPass: boolean;
  zeroR5: boolean;
  acceptancePass: boolean;
  allBandsPopulated: boolean; // by SCALAR band, not target tier
  wireRoundTripPass: boolean;
  perfPass: boolean;
}

export interface VerifyResult {
  roundTrip: boolean; // encode(decode(x)) byte-identical
  unique: boolean; // exactly one model (independent DPLL re-count)
  deducible: boolean; // re-solves at its target tier
  certMatch: boolean; // re-solve reproduces the stored certificate
  solutionMatch: boolean; // the model equals the stored solution bitmask
  needsR5: boolean; // re-solve stalled below ceiling (would require R5)
  ok: boolean;
}

/**
 * Independently re-verify an emitted puzzle across each gate dimension SEPARATELY
 * so a failure can be localized (a wire regression must not read as "uniqueness
 * fail"). This is the check `fumbo verify` and the batch both run.
 */
export function verifyPuzzle(puzzle: Puzzle, certificate: string, tier: TargetTier): VerifyResult {
  const s1 = encodePuzzle({ threadCount: puzzle.threads.length, layoutSeed: puzzle.layoutSeed, constraints: puzzle.constraints, solution: puzzle.solution }, { includeSolution: true });
  const dec = decodePuzzle(s1);
  const s2 = encodePuzzle(dec, { includeSolution: true });
  const roundTrip = s1 === s2;
  const unique = isUnique(dec.threadCount, dec.constraints);
  const re = solve(dec.threadCount, dec.constraints, { tierCeiling: tier });
  const deducible = re.solved;
  const needsR5 = !re.solved && re.needsDeeper;
  const certMatch = re.certificate === certificate;
  let solutionMatch = re.solved;
  for (const t of threadsOf(dec.threadCount)) {
    const bit = Number((puzzle.solution >> BigInt(t.id)) & 1n);
    if (re.value[t.id] !== bit) solutionMatch = false;
  }
  const ok = roundTrip && unique && deducible && certMatch && solutionMatch && !needsR5;
  return { roundTrip, unique, deducible, certMatch, solutionMatch, needsR5, ok };
}

export function runBatch(perBand: number, baseSeed: number): BatchReport {
  const startMs = performanceNow();
  const bands: BandReport[] = [];
  // Independent gate flags — each set only by its own failing check.
  let zeroR5 = true;
  let deducibilityPass = true;
  let wireRoundTripPass = true;
  let uniquenessPass = true;
  const durations: number[] = []; // per-puzzle gen+verify wall time
  const scalarBandTotals: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

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
      const t0 = performanceNow();
      const r = generate(req, bandSeed, 6000);
      if (!r.ok) {
        for (const [k, v] of Object.entries(r.reasons)) rejectReasons[k] = (rejectReasons[k] ?? 0) + v;
        totalAttempts += r.attempts;
        break; // could not fill the band within the attempt budget
      }
      totalAttempts += r.attempts;
      accepted++;
      const v = verifyPuzzle(r.puzzle, r.certificate, tier);
      durations.push(performanceNow() - t0);

      const band = r.puzzle.difficulty.scalar < 3 ? 1 : r.puzzle.difficulty.scalar < 6 ? 2 : r.puzzle.difficulty.scalar < 10 ? 3 : 4;
      scalars.push(r.puzzle.difficulty.scalar);
      bandHistogram[band]!++;
      scalarBandTotals[band]!++;

      if (!v.roundTrip) wireRoundTripPass = false;
      if (!v.unique) uniquenessPass = false;
      if (!v.deducible || !v.certMatch || !v.solutionMatch) deducibilityPass = false;
      if (v.needsR5) zeroR5 = false;
      if (!v.ok) verifyFailures++;
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
  // populated by SCALAR band (what TESTING §2 actually asks), not target tier
  const allBandsPopulated = [1, 2, 3, 4].every((b) => scalarBandTotals[b]! > 0);
  const totalMs = Math.round(performanceNow() - startMs);
  durations.sort((a, b) => a - b);
  const p95Ms = durations.length ? round(durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]!) : 0;
  const perfPass = totalMs < 60_000 && p95Ms < 50;

  return {
    bands,
    totalPuzzles,
    totalMs,
    p95Ms,
    uniquenessPass,
    deducibilityPass,
    zeroR5,
    acceptancePass,
    allBandsPopulated,
    wireRoundTripPass,
    perfPass,
  };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function performanceNow(): number {
  // Available in Node and browser; avoids Date.now for portability.
  return typeof performance !== "undefined" ? performance.now() : 0;
}
