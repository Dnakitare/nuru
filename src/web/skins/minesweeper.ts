// Skin A — "no-guess minesweeper" (Hexcells/Tametsi form). Hexagonal so every
// clue counts ≤6 neighbours, which fits the registry's COUNT arity cap (2..6);
// a square grid's 8-neighbour interior would exceed it. Runs entirely on the
// verified engine: clues are COUNT_EQ constraints, the deduction solver proves
// the board needs no guessing, firstViolated localizes a wrong mark.

import { CType, type Constraint } from "../../core/index.js";
import { grade } from "../../gen/index.js";
import { solve } from "../../solver/index.js";
import { evaluate, greedyReveal } from "./common.js";

const U = -1;

interface Mines {
  rows: number;
  cols: number;
  mine: Uint8Array; // solution: 1 = mine
  constraints: Constraint[];
  ownerOf: number[]; // constraint index → the clue cell it belongs to (-1 = anchor)
  clue: Map<number, number>; // clue cell → neighbour mine count
  scalar: number;
}

// odd-r offset hex neighbours (odd rows pushed right), ≤6 in-bounds
function neighbours(r: number, c: number, rows: number, cols: number): number[] {
  const odd = r & 1;
  const deltas = odd
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

export function genMinesweeper(rows: number, cols: number, density: number): Mines {
  const n = rows * cols;
  for (let attempt = 0; attempt < 600; attempt++) {
    const mine = new Uint8Array(n);
    for (let i = 0; i < n; i++) mine[i] = Math.random() < density ? 1 : 0;

    // clue bundles for each SAFE cell with ≥2 neighbours: anchor it safe + a
    // COUNT_EQ of its neighbours = number of mines around it.
    const bundles: Constraint[][] = [];
    const bundleCell: number[] = [];
    const order: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = r * cols + c;
        if (mine[cell]) continue;
        const nb = neighbours(r, c, rows, cols);
        if (nb.length < 2) continue;
        const k = nb.reduce((s, x) => s + mine[x]!, 0);
        bundles.push([
          { type: CType.ANCHOR, threads: [cell], k: 0 },
          { type: CType.COUNT_EQ, threads: nb, k },
        ]);
        bundleCell.push(cell);
        order.push(order.length);
      }
    }
    // shuffle reveal order so puzzles vary
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const built = greedyReveal(n, [], order.map((i) => bundles[i]!));
    if (!built) continue;

    // Rebuild the puzzle + owner map from the clue bundles that survived thinning.
    const clue = new Map<number, number>();
    const ownerOf: number[] = [];
    const finalConstraints: Constraint[] = [];
    for (const idx of built.keptClues) {
      const cell = bundleCell[order[idx]!]!;
      const nb = neighbours(Math.floor(cell / cols), cell % cols, rows, cols);
      const k = nb.reduce((s, x) => s + mine[x]!, 0);
      clue.set(cell, k);
      finalConstraints.push({ type: CType.ANCHOR, threads: [cell], k: 0 });
      ownerOf.push(cell);
      finalConstraints.push({ type: CType.COUNT_EQ, threads: nb, k });
      ownerOf.push(cell);
    }
    const sr = solve(n, finalConstraints, { tierCeiling: 4 });
    const scalar = grade(sr, finalConstraints, n).scalar;
    return { rows, cols, mine, constraints: finalConstraints, ownerOf, clue, scalar };
  }
  throw new Error("minesweeper generation failed");
}

// ── app ──────────────────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;

interface State {
  p: Mines;
  committed: Int8Array; // -1 unknown, 1 player says mine, 0 player says safe
  startMs: number;
  solveMs: number | null;
}
let st: State | null = null;

function newGame(): void {
  const p = genMinesweeper(7, 6, 0.3);
  const committed = new Int8Array(p.rows * p.cols).fill(U);
  for (const cell of p.clue.keys()) committed[cell] = 0; // clue cells are given-safe
  st = { p, committed, startMs: performance.now(), solveMs: null };
  render();
}

function render(): void {
  const s = st;
  if (!s) return;
  const { p } = s;
  const ev = evaluate(p.rows * p.cols, p.constraints, s.committed);
  const violatedCell = ev.violated >= 0 ? p.ownerOf[ev.violated] ?? -1 : -1;

  const board = $("board");
  board.innerHTML = "";
  const W = 54;
  const H = 48;
  board.style.height = `${p.rows * H + H}px`;
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const cell = r * p.cols + c;
      const x = c * W + (r & 1 ? W / 2 : 0);
      const y = r * (H - 6);
      const el = document.createElement("button");
      el.className = "hex";
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      if (p.clue.has(cell)) {
        el.classList.add("clue");
        el.textContent = String(p.clue.get(cell));
        el.disabled = true;
      } else {
        const v = s.committed[cell];
        if (v === 1) el.classList.add("mine");
        else if (v === 0) el.classList.add("safe");
        else el.classList.add("unknown");
        el.addEventListener("click", () => onCell(cell));
      }
      if (cell === violatedCell) el.classList.add("strain");
      board.appendChild(el);
    }
  }
  // status
  const total = p.mine.reduce((a, b) => a + b, 0);
  let marked = 0;
  for (let i = 0; i < s.committed.length; i++) if (s.committed[i] === 1) marked++;
  const now = $("now");
  if (ev.solved) {
    now.textContent = "solved — no guessing needed";
    now.className = "now win";
    if (s.solveMs === null) s.solveMs = Math.round(performance.now() - s.startMs);
  } else if (ev.violated >= 0) {
    now.textContent = "that can't be right — a number is contradicted";
    now.className = "now bad";
  } else {
    now.textContent = `${total - marked} mines left · ${ev.unknownCount} cells to resolve`;
    now.className = "now";
  }
  $("diff").textContent = `difficulty ${p.scalar}`;
}

function onCell(cell: number): void {
  const s = st;
  if (!s || s.solveMs !== null) return;
  const cur = s.committed[cell];
  s.committed[cell] = cur === U ? 1 : cur === 1 ? 0 : U; // unknown → mine → safe → unknown
  render();
}

if (typeof document !== "undefined") {
  $("new").addEventListener("click", newGame);
  newGame();
}
