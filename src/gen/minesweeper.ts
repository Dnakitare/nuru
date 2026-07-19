// Seeded, reproducible "no-guess" hexagonal minesweeper (Hexcells/Tametsi form)
// on the deduction engine. Hex so every clue counts ≤6 neighbours (fits the
// COUNT arity cap). The greedy-reveal construction guarantees the board is
// UNIQUELY solvable by pure deduction — never a guess — which is the product's
// whole pitch and something classic minesweeper can't promise.
//
// Everything flows from a single u32 seed: the same seed yields the same board
// in every browser, which is what makes a shared Daily Knot and shareable
// result links possible without a server.

import { CType, type Constraint, type DifficultyVector } from "../core/index.js";
import { solve } from "../solver/index.js";
import { grade } from "./grade.js";
import { Rng } from "./rng.js";

export interface MinesBoard {
  seed: number;
  rows: number;
  cols: number;
  mineCount: number;
  mine: Uint8Array; // solution: 1 = mine
  constraints: Constraint[];
  clues: { cell: number; k: number }[]; // revealed number cells
  difficulty: DifficultyVector; // full vector (scalar + maxTier drive the sigil)
}

export interface MinesOpts {
  rows: number;
  cols: number;
  density: number; // fraction of cells that are mines
}

/** odd-r offset hex neighbours (odd rows pushed right), ≤6 in-bounds. */
export function hexNeighbours(r: number, c: number, rows: number, cols: number): number[] {
  const deltas =
    r & 1
      ? [[0, 1], [0, -1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
      : [[0, 1], [0, -1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
  const out: number[] = [];
  for (const [dr, dc] of deltas) {
    const nr = r + dr!;
    const nc = c + dc!;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
  }
  return out;
}

/**
 * Reveal clue bundles in the given order until the solver fully solves, then
 * drop any clue no longer needed. Returns the kept bundle indices, or null if
 * the layout is not fully clue-deducible.
 */
function greedyReveal(threadCount: number, bundles: Constraint[][]): number[] | null {
  const kept: number[] = [];
  const flat = (): Constraint[] => kept.flatMap((i) => bundles[i]!);
  const solved = (): boolean => solve(threadCount, flat(), { tierCeiling: 4 }).solved;

  for (let i = 0; i < bundles.length && !solved(); i++) kept.push(i);
  if (!solved()) return null;
  for (let j = kept.length - 1; j >= 0; j--) {
    const idx = kept[j]!;
    kept.splice(j, 1);
    if (!solve(threadCount, kept.flatMap((i) => bundles[i]!), { tierCeiling: 4 }).solved) kept.push(idx);
  }
  return kept;
}

export function genMinesweeper(seed: number, opts: MinesOpts): MinesBoard {
  const rng = new Rng(seed);
  const { rows, cols, density } = opts;
  const n = rows * cols;

  for (let attempt = 0; attempt < 1200; attempt++) {
    const mine = new Uint8Array(n);
    for (let i = 0; i < n; i++) mine[i] = rng.float() < density ? 1 : 0;

    // a clue bundle per safe cell with ≥2 neighbours: anchor it safe + a
    // COUNT_EQ of its neighbours = the number of mines around it
    const bundles: Constraint[][] = [];
    const cellOf: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = r * cols + c;
        if (mine[cell]) continue;
        const nb = hexNeighbours(r, c, rows, cols);
        if (nb.length < 2) continue;
        const k = nb.reduce((s, x) => s + mine[x]!, 0);
        bundles.push([
          { type: CType.ANCHOR, threads: [cell], k: 0 },
          { type: CType.COUNT_EQ, threads: nb, k },
        ]);
        cellOf.push(cell);
      }
    }
    const order = rng.shuffle([...bundles.keys()]);
    const kept = greedyReveal(n, order.map((i) => bundles[i]!));
    if (!kept) continue;

    const clues: { cell: number; k: number }[] = [];
    const constraints: Constraint[] = [];
    for (const idx of kept) {
      const cell = cellOf[order[idx]!]!;
      const nb = hexNeighbours(Math.floor(cell / cols), cell % cols, rows, cols);
      const k = nb.reduce((s, x) => s + mine[x]!, 0);
      clues.push({ cell, k });
      constraints.push({ type: CType.ANCHOR, threads: [cell], k: 0 });
      constraints.push({ type: CType.COUNT_EQ, threads: nb, k });
    }

    const sr = solve(n, constraints, { tierCeiling: 4 });
    if (!sr.solved) continue;
    let mineCount = 0;
    for (let i = 0; i < n; i++) mineCount += mine[i]!;
    return { seed, rows, cols, mineCount, mine, constraints, clues, difficulty: grade(sr, constraints, n) };
  }
  throw new Error("minesweeper generation failed to converge");
}

/** A stable u32 seed for a given UTC calendar date — the day's shared board. */
export function dailySeed(year: number, month1to12: number, day: number): number {
  let z = ((year * 10000 + month1to12 * 100 + day) ^ 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}
