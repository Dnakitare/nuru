// `fumbo bench` — the timed blind-solve harness (SPEC-GENERATOR §4.2). Presents
// puzzles in readable text, times each solve from display to answer, checks the
// answer against the unique solution, and persists per-puzzle records. The
// report computes Spearman(scalar, solveMs) — the human-anchoring gate.
//
// This is the Phase 1 stand-in for the tactile timer: the game will replace the
// text prompt with the knot UI, but the solve-time record it writes is the same
// concept (feeds telemetry durationMs and the result-payload durationSec later).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  CType,
  encodePuzzle,
  isCountType,
  puzzleDigestHex,
  type Constraint,
  type WirePuzzle,
} from "../src/core/index.js";
import { generate, LADDER, type TargetTier } from "../src/gen/index.js";
import { mixSeed } from "../src/gen/rng.js";

export interface SolveRecord {
  ts: number; // epoch ms when solved
  digest: string;
  payload: string; // shared fmb1_ (replayable)
  tier: TargetTier; // stored, never shown during solving (blind)
  scalar: number;
  threadCount: number;
  solveMs: number;
  correct: boolean;
  skipped: boolean;
}

// ── readable text rendering ──────────────────────────────────────────────────

function renderConstraint(c: Constraint): string | null {
  const T = (i: number) => `#${i}`;
  const list = (ts: readonly number[]) => ts.map(T).join(", ");
  switch (c.type) {
    case CType.ANCHOR:
      return `${T(c.threads[0]!)} is ${c.k === 1 ? "TRUE" : "FALSE"}   (given)`;
    case CType.IMPL:
      return `if ${T(c.threads[0]!)} is TRUE then ${T(c.threads[1]!)} is TRUE`;
    case CType.XOR:
      return `exactly one of ${list(c.threads)} is TRUE`;
    case CType.NAND:
      return `not both ${list(c.threads)} are TRUE`;
    case CType.OR:
      return `at least one of ${list(c.threads)} is TRUE`;
    case CType.EQUIV:
      return `${T(c.threads[0]!)} and ${T(c.threads[1]!)} have the same value`;
    case CType.COUNT_EQ:
      return `exactly ${c.k} of {${list(c.threads)}} are TRUE`;
    case CType.COUNT_LE:
      return `at most ${c.k} of {${list(c.threads)}} are TRUE`;
    case CType.COUNT_GE:
      return `at least ${c.k} of {${list(c.threads)}} are TRUE`;
  }
  return null;
}

function renderPuzzle(wp: WirePuzzle, index: number, total: number): string {
  const L: string[] = [];
  L.push(`\n── puzzle ${index}/${total} ${"─".repeat(40)}`);
  L.push(`${wp.threadCount} threads: ${[...Array(wp.threadCount).keys()].map((i) => `#${i}`).join(" ")}`);
  L.push("rules:");
  // Anchors first (they are the pull-in points), then the rest.
  const anchors = wp.constraints.filter((c) => c.type === CType.ANCHOR);
  const rest = wp.constraints.filter((c) => c.type !== CType.ANCHOR);
  for (const c of [...anchors, ...rest]) {
    const line = renderConstraint(c);
    if (line) L.push(`   • ${line}`);
  }
  L.push("");
  L.push("enter the TRUE threads (e.g. \"0 2 5\"), a bitstring, \"none\", \"s\" skip, or \"q\" quit:");
  return L.join("\n");
}

// ── answer parsing ───────────────────────────────────────────────────────────

type Parsed = { kind: "answer"; mask: bigint } | { kind: "skip" } | { kind: "quit" } | { kind: "bad" };

function parseAnswer(raw: string, n: number): Parsed {
  const s = raw.trim().toLowerCase();
  if (s === "q" || s === "quit") return { kind: "quit" };
  if (s === "s" || s === "skip") return { kind: "skip" };
  if (s === "none" || s === "") return { kind: "answer", mask: 0n };
  // Bitstring form: exactly n chars of 0/1, thread i = char i.
  if (/^[01]+$/.test(s) && s.length === n) {
    let m = 0n;
    for (let i = 0; i < n; i++) if (s[i] === "1") m |= 1n << BigInt(i);
    return { kind: "answer", mask: m };
  }
  // List form: TRUE thread indices.
  const parts = s.split(/[\s,]+/).filter(Boolean);
  let m = 0n;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v >= n) return { kind: "bad" };
    m |= 1n << BigInt(v);
  }
  return { kind: "answer", mask: m };
}

// ── blind sample ─────────────────────────────────────────────────────────────

interface Item {
  wp: WirePuzzle;
  tier: TargetTier;
  scalar: number;
  digest: string;
  payload: string;
}

/** Generate a shuffled ladder sample, tiers hidden until the report. */
function buildSample(n: number, seed: number): Item[] {
  const perTier = Math.max(1, Math.round(n / 4));
  const items: Item[] = [];
  for (const tier of [1, 2, 3, 4] as TargetTier[]) {
    let made = 0;
    for (let k = 0; made < perTier && k < perTier * 200; k++) {
      const r = generate(LADDER[tier], mixSeed(seed ^ (tier * 0x9e3779b9), k));
      if (!r.ok) continue;
      made++;
      const wp: WirePuzzle = {
        threadCount: r.puzzle.threads.length,
        layoutSeed: r.puzzle.layoutSeed,
        constraints: [...r.puzzle.constraints],
        solution: r.puzzle.solution,
      };
      const payload = encodePuzzle(wp); // shared form omits the solution
      items.push({ wp, tier, scalar: r.puzzle.difficulty.scalar, digest: puzzleDigestHex(wp.threadCount, wp.constraints), payload });
    }
  }
  // Deterministic shuffle from the same seed (so a run is reproducible).
  let a = (seed ^ 0x2545f491) >>> 0;
  const rand = () => ((a = (Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) ^ Math.imul(a ^ (a >>> 13), 0x297a2d39)) >>> 0) / 2 ** 32);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

// ── persistence ──────────────────────────────────────────────────────────────

function loadLog(path: string): SolveRecord[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SolveRecord[]) : [];
}
function saveLog(path: string, records: SolveRecord[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(records, null, 2) + "\n");
}

// ── interactive run ──────────────────────────────────────────────────────────

export async function runBench(n: number, seed: number, logPath: string): Promise<void> {
  if (!stdin.isTTY) {
    console.error("bench needs an interactive terminal. Run it directly, e.g. `npm run fumbo -- bench --n 30`.");
    console.error("(For a non-interactive summary of past runs, use `fumbo bench --report`.)");
    process.exit(1);
  }
  const sample = buildSample(n, seed);
  const log = loadLog(logPath);
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log(`Blind solve — ${sample.length} puzzles. Difficulty is hidden. Take your time; the clock`);
  console.log(`runs per puzzle from when it appears until you answer. Ctrl-C is safe (progress saved).`);

  let done = 0;
  try {
    for (let i = 0; i < sample.length; i++) {
      const it = sample[i]!;
      let record: SolveRecord | null = null;
      for (;;) {
        const t0 = performance.now();
        const raw = await rl.question(renderPuzzle(it.wp, i + 1, sample.length) + "\n> ");
        const solveMs = Math.round(performance.now() - t0);
        const parsed = parseAnswer(raw, it.wp.threadCount);
        if (parsed.kind === "quit") {
          console.log("stopping — progress saved.");
          saveLog(logPath, log);
          rl.close();
          printReport(log);
          return;
        }
        if (parsed.kind === "bad") {
          console.log("  ↳ couldn't parse that. Use thread numbers like \"0 2 5\", a bitstring, or \"none\".");
          continue;
        }
        const skipped = parsed.kind === "skip";
        const correct = !skipped && parsed.kind === "answer" && parsed.mask === it.wp.solution;
        record = {
          ts: Date.now(),
          digest: it.digest,
          payload: it.payload,
          tier: it.tier,
          scalar: it.scalar,
          threadCount: it.wp.threadCount,
          solveMs,
          correct,
          skipped,
        };
        if (skipped) console.log("  ↳ skipped.");
        else console.log(`  ↳ ${correct ? "correct" : "incorrect"} · ${(solveMs / 1000).toFixed(1)}s`);
        break;
      }
      log.push(record);
      saveLog(logPath, log); // save after every puzzle
      done++;
    }
  } finally {
    rl.close();
  }
  console.log(`\nDone — ${done} puzzles this session, log at ${logPath}`);
  printReport(log);
}

export function benchReport(logPath: string): void {
  const log = loadLog(logPath);
  if (log.length === 0) {
    console.error(`no records in ${logPath} yet. Run \`fumbo bench --n 30\` first.`);
    process.exit(1);
  }
  printReport(log);
}

// ── Spearman + report ────────────────────────────────────────────────────────

/** Fractional ranks with ties averaged. */
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank over the tie group
    for (let k = i; k <= j; k++) r[idx[k]![1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(xs: number[], ys: number[]): number {
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / n;
  const mx = mean(rx);
  const my = mean(ry);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i]! - mx;
    const dy = ry[i]! - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy);
}

function printReport(log: SolveRecord[]): void {
  const solved = log.filter((r) => r.correct);
  console.log(`\n── human-anchoring report (SPEC-GENERATOR §4.2) ${"─".repeat(20)}`);
  console.log(`records: ${log.length}   correct: ${solved.length}   incorrect: ${log.filter((r) => !r.correct && !r.skipped).length}   skipped: ${log.filter((r) => r.skipped).length}`);

  // Per-tier median solve time (sanity: should rise with tier).
  for (const tier of [1, 2, 3, 4] as TargetTier[]) {
    const ts = solved.filter((r) => r.tier === tier).map((r) => r.solveMs).sort((a, b) => a - b);
    if (ts.length === 0) continue;
    const med = ts[Math.floor(ts.length / 2)]!;
    console.log(`  T${tier}: n=${ts.length}  median ${(med / 1000).toFixed(1)}s`);
  }

  if (solved.length < 5) {
    console.log(`\nNeed ≥5 correct solves for a meaningful correlation (have ${solved.length}). Keep going.`);
    return;
  }
  const rho = spearman(solved.map((r) => r.scalar), solved.map((r) => r.solveMs));
  const pass = rho >= 0.7;
  console.log(`\nSpearman(scalar, solveTime) = ${rho.toFixed(3)}  over ${solved.length} correct solves`);
  console.log(pass ? "✅ GATE PASS (≥ 0.7): the difficulty scalar tracks real solve effort." : "❌ below 0.7: retune §4.3 scalar WEIGHTS (never the rule taxonomy), then re-anchor.");
}
