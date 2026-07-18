#!/usr/bin/env -S npx tsx
// Fumbo Phase 1 CLI (SPEC-GENERATOR §5). Commands: gen, grade, verify, trace,
// batch, vectors. Logic-only; no pixels. Reproducible via seeds.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodePuzzle,
  encodePuzzle,
  peekKind,
  puzzleDigestHex,
  type DifficultyVector,
  type WirePuzzle,
} from "../src/core/index.js";
import { RULE_NAME, solve, type SolveResult } from "../src/solver/index.js";
import { generate, grade, isUnique, LADDER, runBatch, type GenRequest, type TargetTier } from "../src/gen/index.js";
import { has, num, parse, range, str, type Args } from "./args.js";
import { emitVectors } from "./vectors.js";
import { benchReport, runBench } from "./bench.js";

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parse(rest);
  try {
    switch (cmd) {
      case "gen": return cmdGen(args);
      case "grade": return cmdGrade(args);
      case "verify": return cmdVerify(args);
      case "trace": return cmdTrace(args);
      case "batch": return cmdBatch(args);
      case "bench": return await cmdBench(args);
      case "vectors": return cmdVectors(args);
      case "help": case undefined: return help();
      default:
        console.error(`unknown command: ${cmd}`);
        help();
        process.exit(1);
    }
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}

function help(): void {
  console.log(`fumbo — Phase 1 logic-core CLI

  gen     --tier N [--steps a..b] [--threads a..b] [--seed N] [--modality symbolic] [--with-solution]
  grade   <fmb1_...>            print the DifficultyVector + trace summary
  verify  <fmb1_...>            uniqueness + deducibility + certificate + wire round-trip
  trace   <fmb1_...> [--full]   human-readable canonical solve trace
  batch   --n N [--seed N]      generate N across the ladder, verify all, write the gate report
  bench   --n N [--seed N]      timed blind solve — records solve times, reports Spearman (§4.2)
  bench   --report              print the human-anchoring report from past runs
  vectors --emit                (re)generate append-only test vectors

Tiers: 1 tutorial · 2 daily · 3 tangle mainstream · 4 tangle frontier`);
}

function requireTier(args: Args): TargetTier {
  const t = num(args, "tier", 0);
  if (t < 1 || t > 4) throw new Error("--tier must be 1, 2, 3, or 4");
  return t as TargetTier;
}

function fmtVector(d: DifficultyVector): string {
  return (
    `  maxTier=${d.maxTier}  steps=${d.steps}  maxChain=${d.maxChain}  ` +
    `minWidth=${d.minWidth}  hypoCount=${d.hypoCount}  threads=${d.threadCount}\n` +
    `  scalar=${d.scalar}  band=T${d.scalar < 3 ? 1 : d.scalar < 6 ? 2 : d.scalar < 10 ? 3 : 4}`
  );
}

function traceSummary(r: SolveResult): string {
  const byTier: Record<number, number> = {};
  for (const s of r.trace) byTier[s.tier] = (byTier[s.tier] ?? 0) + 1;
  const tiers = Object.entries(byTier).map(([t, n]) => `T${t}:${n}`).join(" ");
  return `  ${r.trace.length} steps  [${tiers}]  cert=${r.certificate.slice(0, 16)}…`;
}

function cmdGen(args: Args): void {
  const tier = requireTier(args);
  const base = LADDER[tier];
  const req: GenRequest = {
    targetTier: tier,
    targetSteps: range(args, "steps", base.targetSteps),
    threadCount: range(args, "threads", base.threadCount),
  };
  const modality = str(args, "modality", "symbolic");
  if (modality !== "symbolic") throw new Error("v1 supports only --modality symbolic");
  const seed = num(args, "seed", (Date.now() ^ 0x9e3779b9) >>> 0);

  const r = generate(req, seed);
  if (!r.ok) {
    console.error(`no puzzle accepted in ${r.attempts} attempts: ${JSON.stringify(r.reasons)}`);
    process.exit(1);
  }
  const p = r.puzzle;
  const wp: WirePuzzle = { threadCount: p.threads.length, layoutSeed: p.layoutSeed, constraints: [...p.constraints], solution: p.solution };
  const sr = solve(wp.threadCount, wp.constraints, { tierCeiling: tier });
  console.log(`seed ${r.seed}  (accepted on attempt ${r.attempts})  modality ${modality}`);
  console.log(`digest ${puzzleDigestHex(wp.threadCount, wp.constraints)}`);
  console.log(fmtVector(p.difficulty));
  console.log(traceSummary(sr));
  console.log(`shared: ${encodePuzzle(wp)}`);
  if (has(args, "with-solution")) console.log(`local:  ${encodePuzzle(wp, { includeSolution: true })}`);
}

function loadPuzzle(args: Args): { wp: WirePuzzle; payload: string } {
  const payload = args._[0];
  if (!payload) throw new Error("expected an fmb1_ payload argument");
  if (peekKind(payload) !== 0) throw new Error("payload is not a puzzle (kind 0)");
  return { wp: decodePuzzle(payload), payload };
}

function cmdGrade(args: Args): void {
  const { wp } = loadPuzzle(args);
  const r = solve(wp.threadCount, wp.constraints, { tierCeiling: 4 });
  if (!r.solved) {
    console.log(r.needsDeeper ? "not deducible within tiers ≤4 (would require R5)" : "not deducible (contradiction / unsat)");
    process.exit(1);
  }
  const d = grade(r, wp.constraints, wp.threadCount);
  console.log(fmtVector(d));
  console.log(traceSummary(r));
}

function cmdVerify(args: Args): void {
  const { wp } = loadPuzzle(args);
  const unique = isUnique(wp.threadCount, wp.constraints);
  const r = solve(wp.threadCount, wp.constraints, { tierCeiling: 4 });
  const roundTrip = encodePuzzle(wp) === encodePuzzle(decodePuzzle(encodePuzzle(wp)));
  const deducible = r.solved && !r.needsDeeper;
  const ok = unique && deducible && roundTrip;
  console.log(`uniqueness:   ${unique ? "PASS (exactly one model)" : "FAIL"}`);
  console.log(`deducibility: ${deducible ? "PASS" : r.needsDeeper ? "FAIL (needs R5)" : "FAIL"}`);
  console.log(`wire:         ${roundTrip ? "PASS (round-trip identical)" : "FAIL"}`);
  console.log(`certificate:  ${r.certificate}`);
  console.log(`digest:       ${puzzleDigestHex(wp.threadCount, wp.constraints)}`);
  console.log(ok ? "VERIFY OK" : "VERIFY FAILED");
  if (!ok) process.exit(1);
}

function cmdTrace(args: Args): void {
  const { wp } = loadPuzzle(args);
  const r = solve(wp.threadCount, wp.constraints, { tierCeiling: 4 });
  console.log(`${r.solved ? "solved" : "NOT solved"} in ${r.trace.length} steps  (cert ${r.certificate.slice(0, 16)}…)`);
  const full = has(args, "full");
  const steps = full ? r.trace : r.trace.slice(0, 20);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const where = s.constraint === -1 ? "hypothesis" : `c#${s.constraint}`;
    console.log(`  ${String(i + 1).padStart(3)}. ${RULE_NAME[s.rule] ?? s.rule}  ${where}  ⇒ thread ${s.thread} = ${s.value ? "TRUE" : "FALSE"}`);
  }
  if (!full && r.trace.length > steps.length) console.log(`  … ${r.trace.length - steps.length} more (use --full)`);
}

function cmdBatch(args: Args): void {
  const n = num(args, "n", 1000);
  const perBand = Math.max(1, Math.round(n / 4));
  const seed = num(args, "seed", 0x0f0f0f);
  console.log(`Running batch: ${perBand} per band × 4 bands (seed ${seed})…`);
  const rep = runBatch(perBand, seed);
  const md = renderBatchReport(rep, n, seed);
  console.log(md);
  const out = join(process.cwd(), "docs", "PHASE1-BATCH.md");
  writeFileSync(out, md + "\n");
  console.log(`\nGate report written to ${out}`);
  const gatePass = rep.uniquenessPass && rep.deducibilityPass && rep.zeroR5 && rep.acceptancePass && rep.allBandsPopulated && rep.wireRoundTripPass;
  if (!gatePass) process.exit(1);
}

function renderBatchReport(rep: ReturnType<typeof runBatch>, requested: number, seed: number): string {
  const L: string[] = [];
  L.push(`# Phase 1 Batch Gate Report`);
  L.push("");
  L.push(`Generated by \`fumbo batch --n ${requested}\` (seed ${seed}). Reproducible.`);
  L.push("");
  L.push(`- Total puzzles: **${rep.totalPuzzles}**`);
  L.push(`- Wall time: **${rep.totalMs}ms**`);
  L.push("");
  L.push(`## Gate checklist`);
  L.push("");
  const chk = (b: boolean) => (b ? "✅" : "❌");
  L.push(`- ${chk(rep.uniquenessPass)} 100% uniqueness (independent re-count)`);
  L.push(`- ${chk(rep.deducibilityPass)} 100% deducibility at target tier + certificate match`);
  L.push(`- ${chk(rep.zeroR5)} 0 R5-requiring puzzles`);
  L.push(`- ${chk(rep.acceptancePass)} Acceptance ≥5% per band`);
  L.push(`- ${chk(rep.allBandsPopulated)} All four bands populated`);
  L.push(`- ${chk(rep.wireRoundTripPass)} Wire round-trip byte-identical`);
  L.push("");
  L.push(`## Per-band`);
  L.push("");
  L.push(`| Tier | Accepted | Acceptance | scalar min/mean/max | verify fails | reject reasons |`);
  L.push(`|------|----------|-----------|---------------------|--------------|----------------|`);
  for (const b of rep.bands) {
    const reasons = Object.entries(b.rejectReasons).map(([k, v]) => `${k}:${v}`).join(", ") || "—";
    L.push(
      `| T${b.tier} | ${b.accepted}/${b.requested} | ${(b.acceptanceRate * 100).toFixed(1)}% | ` +
        `${b.scalar.min} / ${b.scalar.mean} / ${b.scalar.max} | ${b.verifyFailures} | ${reasons} |`,
    );
  }
  L.push("");
  L.push(`## Grade distribution (accepted puzzles by scalar band)`);
  L.push("");
  L.push(`| Target | →T1 | →T2 | →T3 | →T4 |`);
  L.push(`|--------|-----|-----|-----|-----|`);
  for (const b of rep.bands) {
    const h = b.bandHistogram;
    L.push(`| T${b.tier} | ${h[1]} | ${h[2]} | ${h[3]} | ${h[4]} |`);
  }
  return L.join("\n");
}

function cmdVectors(args: Args): void {
  if (!has(args, "emit")) throw new Error("usage: fumbo vectors --emit");
  emitVectors();
}

async function cmdBench(args: Args): Promise<void> {
  const logPath = str(args, "log", join(process.cwd(), "bench", "solve-log.json"));
  if (has(args, "report")) return benchReport(logPath);
  const n = num(args, "n", 30);
  const seed = num(args, "seed", 0x5eed);
  await runBench(n, seed, logPath);
}

void main();
