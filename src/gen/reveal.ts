// "Reveal" — a novel glyph-deduction game on the engine. The hidden solution is
// a symmetric (bilateral) glyph on a 6×6 grid; the player deduces which cells
// are lit from picross-style row/column counts PLUS relational links between
// cells ("= these match", "× these differ"). Every board is uniquely solvable by
// pure deduction, and the solved board IS the reward — a luminous rune emerges.
//
// This finally exercises the relational half of the engine (EQUIV/XOR), not just
// counting. Grid is 6-wide so row/column COUNT clues stay within the arity cap.

import { CType, type Constraint, type DifficultyVector } from "../core/index.js";
import { solve } from "../solver/index.js";
import { GLYPHS, REVEAL_TIERS } from "./glyphs.js";
import { grade } from "./grade.js";
import { Rng } from "./rng.js";

export type RevealTier = "easy" | "medium" | "hard";

/**
 * The daily's difficulty by weekday (0=Sun..6=Sat): a gentle ramp so the ritual
 * is predictable — easy early week, hardest on the weekend, like a crossword.
 */
export function dailyTier(weekday: number): RevealTier {
  return (["medium", "easy", "easy", "medium", "medium", "hard", "hard"] as const)[weekday % 7]!;
}

export function tierPool(tier: RevealTier): number[] {
  return tier === "hard" ? REVEAL_TIERS.hard : tier === "medium" ? REVEAL_TIERS.medium : REVEAL_TIERS.easy;
}

export interface RevealLink {
  a: number;
  b: number;
  eq: boolean; // EQUIV (=) vs XOR (×)
}
export interface RevealBoard {
  seed: number;
  name: string; // the glyph's name — revealed on solve
  rows: number;
  cols: number;
  sol: Uint8Array; // 1 = lit
  rowCounts: number[];
  colCounts: number[];
  constraints: Constraint[];
  links: RevealLink[]; // relational clues surfaced on the grid
  givens: { cell: number; v: 0 | 1 }[]; // anchor clues
  difficulty: DifficultyVector;
}

export interface RevealOpts {
  rows: number;
  cols: number; // ≤ 6 so line COUNT clues fit the arity cap
}

/** Reveal clue bundles (after the always-present count rules) until solved, then thin. */
function greedyReveal(threadCount: number, rules: Constraint[], bundles: Constraint[][]): number[] | null {
  const kept: number[] = [];
  const flat = (): Constraint[] => [...rules, ...kept.flatMap((i) => bundles[i]!)];
  const solved = (): boolean => solve(threadCount, flat(), { tierCeiling: 4 }).solved;
  for (let i = 0; i < bundles.length && !solved(); i++) kept.push(i);
  if (!solved()) return null;
  for (let j = kept.length - 1; j >= 0; j--) {
    const idx = kept[j]!;
    kept.splice(j, 1);
    if (!solve(threadCount, [...rules, ...kept.flatMap((i) => bundles[i]!)], { tierCeiling: 4 }).solved) kept.push(idx);
  }
  return kept;
}

type BundleMeta = { kind: "link"; link: RevealLink } | { kind: "given"; given: { cell: number; v: 0 | 1 } };

export function genReveal(seed: number, _opts: RevealOpts, pool?: number[]): RevealBoard {
  const rng = new Rng(seed);
  const glyph = pool && pool.length ? GLYPHS[pool[rng.int(pool.length)]!]! : GLYPHS[rng.int(GLYPHS.length)]!;
  const { rows, cols, cells: sol, name } = glyph;
  const n = rows * cols;

  // always-present clues: row + column counts (the picross scaffolding)
  const rules: Constraint[] = [];
  const rowCounts: number[] = [];
  const colCounts: number[] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    let k = 0;
    for (let c = 0; c < cols; c++) {
      row.push(r * cols + c);
      k += sol[r * cols + c]!;
    }
    rowCounts.push(k);
    rules.push({ type: CType.COUNT_EQ_WIDE, threads: row, k });
  }
  for (let c = 0; c < cols; c++) {
    const col: number[] = [];
    let k = 0;
    for (let r = 0; r < rows; r++) {
      col.push(r * cols + c);
      k += sol[r * cols + c]!;
    }
    colCounts.push(k);
    rules.push({ type: CType.COUNT_EQ_WIDE, threads: col, k });
  }

  // candidate clues: relational links (preferred) then anchor givens (last resort)
  const linkMeta: RevealLink[] = [];
  const linkBundles: Constraint[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c;
      const nbrs: number[] = [];
      if (c + 1 < cols) nbrs.push(cell + 1);
      if (r + 1 < rows) nbrs.push(cell + cols);
      for (const b of nbrs) {
        const eq = sol[cell] === sol[b];
        linkMeta.push({ a: cell, b, eq });
        linkBundles.push([{ type: eq ? CType.EQUIV : CType.XOR, threads: [cell, b] }]);
      }
    }
  }
  const givenMeta: { cell: number; v: 0 | 1 }[] = [];
  const givenBundles: Constraint[][] = [];
  for (let i = 0; i < n; i++) {
    givenMeta.push({ cell: i, v: sol[i] as 0 | 1 });
    givenBundles.push([{ type: CType.ANCHOR, threads: [i], k: sol[i]! }]);
  }

  // Try several clue shufflings; keep the one that hides the glyph best (fewest
  // anchor givens — ideally zero, so nothing is pre-lit).
  let best: { kept: number[]; bundles: Constraint[][]; meta: BundleMeta[]; givens: number } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const linkOrder = rng.shuffle([...linkBundles.keys()]);
    const givenOrder = rng.shuffle([...givenBundles.keys()]);
    const bundles = [...linkOrder.map((i) => linkBundles[i]!), ...givenOrder.map((i) => givenBundles[i]!)];
    const meta: BundleMeta[] = [
      ...linkOrder.map((i) => ({ kind: "link" as const, link: linkMeta[i]! })),
      ...givenOrder.map((i) => ({ kind: "given" as const, given: givenMeta[i]! })),
    ];
    const kept = greedyReveal(n, rules, bundles);
    if (!kept) continue;
    const givensUsed = kept.filter((i) => meta[i]!.kind === "given").length;
    if (!best || givensUsed < best.givens) best = { kept, bundles, meta, givens: givensUsed };
    if (givensUsed === 0) break;
  }
  if (!best) throw new Error("reveal generation failed to converge");

  const links: RevealLink[] = [];
  const givens: { cell: number; v: 0 | 1 }[] = [];
  const constraints = [...rules];
  for (const idx of best.kept) {
    const m = best.meta[idx]!;
    constraints.push(...best.bundles[idx]!);
    if (m.kind === "link") links.push(m.link);
    else givens.push(m.given);
  }

  const sr = solve(n, constraints, { tierCeiling: 4 });
  return { seed, name, rows, cols, sol, rowCounts, colCounts, constraints, links, givens, difficulty: grade(sr, constraints, n) };
}

/** Stable per-date seed for the daily glyph. */
export function revealDailySeed(year: number, month1to12: number, day: number): number {
  let z = ((year * 10000 + month1to12 * 100 + day) ^ 0x5bd1e995) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0x5bd1e995) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}
