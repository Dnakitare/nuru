// Skin B — a Tango/Queens-style daily grid on the same engine. An N×N binary
// grid (N=6): each row/col balanced (COUNT_EQ = N/2), no three-in-a-row
// (COUNT_LE 2 + COUNT_GE 1 over every triple), plus given cells (ANCHOR) and
// =/× links (EQUIV/XOR). Row/col balance is arity N — N=6 sits exactly at the
// registry's COUNT arity cap of 6. Greedy reveal guarantees unique + no-guess.

import { CType, type Constraint } from "../../core/index.js";
import { grade } from "../../gen/index.js";
import { solve } from "../../solver/index.js";
import { evaluate, greedyReveal } from "./common.js";

const U = -1;
const N = 6;
const HALF = N / 2;

interface Link {
  a: number;
  b: number;
  eq: boolean; // EQUIV (=) vs XOR (×)
}
interface Grid {
  n: number;
  sol: Uint8Array;
  constraints: Constraint[];
  ownerCells: number[][]; // constraint index → cells it involves (for strain highlight)
  givens: Map<number, 0 | 1>;
  links: Link[];
  scalar: number;
}

function randomSolution(): Uint8Array | null {
  const size = N * N;
  const g = new Int8Array(size).fill(-1);
  const lineCount = (cells: number[]): [number, number] => {
    let o = 0;
    let z = 0;
    for (const i of cells) g[i] === 1 ? o++ : g[i] === 0 ? z++ : 0;
    return [o, z];
  };
  const place = (idx: number): boolean => {
    if (idx === size) return true;
    const r = Math.floor(idx / N);
    const c = idx % N;
    const vals = Math.random() < 0.5 ? [0, 1] : [1, 0];
    for (const v of vals) {
      g[idx] = v as 0 | 1;
      const row: number[] = [];
      const col: number[] = [];
      for (let k = 0; k < N; k++) {
        row.push(r * N + k);
        col.push(k * N + c);
      }
      const [ro, rz] = lineCount(row);
      const [co, cz] = lineCount(col);
      if (ro > HALF || rz > HALF || co > HALF || cz > HALF) {
        g[idx] = -1;
        continue;
      }
      if (c >= 2 && g[idx] === g[idx - 1] && g[idx] === g[idx - 2]) {
        g[idx] = -1;
        continue;
      }
      if (r >= 2 && g[idx] === g[idx - N] && g[idx] === g[idx - 2 * N]) {
        g[idx] = -1;
        continue;
      }
      if (place(idx + 1)) return true;
      g[idx] = -1;
    }
    return false;
  };
  return place(0) ? Uint8Array.from(g) : null;
}

export function genGrid(): Grid {
  const size = N * N;
  let sol: Uint8Array | null = null;
  for (let a = 0; a < 40 && !sol; a++) sol = randomSolution();
  if (!sol) throw new Error("grid solution search failed");

  // fixed game rules (always shown to the player)
  const rules: Constraint[] = [];
  for (let r = 0; r < N; r++) {
    const row: number[] = [];
    for (let c = 0; c < N; c++) row.push(r * N + c);
    rules.push({ type: CType.COUNT_EQ, threads: row, k: HALF });
    for (let c = 0; c + 2 < N; c++) {
      const tri = [r * N + c, r * N + c + 1, r * N + c + 2];
      rules.push({ type: CType.COUNT_LE, threads: tri, k: 2 });
      rules.push({ type: CType.COUNT_GE, threads: tri, k: 1 });
    }
  }
  for (let c = 0; c < N; c++) {
    const col: number[] = [];
    for (let r = 0; r < N; r++) col.push(r * N + c);
    rules.push({ type: CType.COUNT_EQ, threads: col, k: HALF });
    for (let r = 0; r + 2 < N; r++) {
      const tri = [r * N + c, (r + 1) * N + c, (r + 2) * N + c];
      rules.push({ type: CType.COUNT_LE, threads: tri, k: 2 });
      rules.push({ type: CType.COUNT_GE, threads: tri, k: 1 });
    }
  }

  // candidate clues: adjacency links (=/×) preferred, then anchor givens
  const linkBundles: { bundle: Constraint[]; link: Link }[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = r * N + c;
      const pairs: [number, number][] = [];
      if (c + 1 < N) pairs.push([cell, cell + 1]);
      if (r + 1 < N) pairs.push([cell, cell + N]);
      for (const [a, b] of pairs) {
        const eq = sol[a] === sol[b];
        linkBundles.push({ bundle: [{ type: eq ? CType.EQUIV : CType.XOR, threads: [a, b] }], link: { a, b, eq } });
      }
    }
  }
  const givenBundles: { bundle: Constraint[]; cell: number }[] = [];
  for (let i = 0; i < size; i++) givenBundles.push({ bundle: [{ type: CType.ANCHOR, threads: [i], k: sol[i]! }], cell: i });

  shuffle(linkBundles);
  shuffle(givenBundles);
  const candidates = [...linkBundles.map((x) => x.bundle), ...givenBundles.map((x) => x.bundle)];
  const meta = [...linkBundles, ...givenBundles];

  const built = greedyReveal(size, rules, candidates);
  if (!built) throw new Error("grid reveal failed"); // can't happen: all-givens solves

  const givens = new Map<number, 0 | 1>();
  const links: Link[] = [];
  for (const idx of built.keptClues) {
    const m = meta[idx]!;
    if ("cell" in m) givens.set(m.cell, sol![m.cell] as 0 | 1);
    else links.push(m.link);
  }

  const ownerCells: number[][] = built.constraints.map((c) => [...c.threads]);
  const sr = solve(size, built.constraints, { tierCeiling: 4 });
  const scalar = grade(sr, built.constraints, size).scalar;
  return { n: N, sol: sol!, constraints: built.constraints, ownerCells, givens, links, scalar };
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

// ── app ──────────────────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;
const CELL = 58;
const GAP = 6;

interface State {
  p: Grid;
  committed: Int8Array;
  startMs: number;
  solveMs: number | null;
}
let st: State | null = null;

function newGame(): void {
  const p = genGrid();
  const committed = new Int8Array(p.n * p.n).fill(U);
  for (const [cell, v] of p.givens) committed[cell] = v;
  st = { p, committed, startMs: performance.now(), solveMs: null };
  render();
}

function render(): void {
  const s = st;
  if (!s) return;
  const { p, committed } = s;
  const ev = evaluate(p.n * p.n, p.constraints, committed);
  const strained = new Set<number>();
  if (ev.violated >= 0) for (const c of p.ownerCells[ev.violated]!) strained.add(c);

  const board = $("board");
  board.innerHTML = "";
  board.style.width = board.style.height = `${p.n * (CELL + GAP) - GAP}px`;
  for (let r = 0; r < p.n; r++) {
    for (let c = 0; c < p.n; c++) {
      const cell = r * p.n + c;
      const el = document.createElement("button");
      el.className = "cell";
      el.style.left = `${c * (CELL + GAP)}px`;
      el.style.top = `${r * (CELL + GAP)}px`;
      const v = committed[cell];
      const given = p.givens.has(cell);
      if (v === 1) el.classList.add("full");
      else if (v === 0) el.classList.add("empty");
      if (given) el.classList.add("given");
      if (strained.has(cell)) el.classList.add("strain");
      el.textContent = v === 1 ? "●" : v === 0 ? "○" : "";
      if (!given) el.addEventListener("click", () => onCell(cell));
      else el.disabled = true;
      board.appendChild(el);
    }
  }
  // link badges (= / ×) at the midpoint between the two cells
  for (const lk of p.links) {
    const ar = Math.floor(lk.a / p.n);
    const ac = lk.a % p.n;
    const br = Math.floor(lk.b / p.n);
    const bc = lk.b % p.n;
    const x = ((ac + bc) / 2) * (CELL + GAP) + CELL / 2;
    const y = ((ar + br) / 2) * (CELL + GAP) + CELL / 2;
    const b = document.createElement("div");
    b.className = "link";
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    b.textContent = lk.eq ? "=" : "×";
    board.appendChild(b);
  }

  const now = $("now");
  if (ev.solved) {
    now.textContent = "solved — no guessing needed";
    now.className = "now win";
    if (s.solveMs === null) s.solveMs = Math.round(performance.now() - s.startMs);
  } else if (ev.violated >= 0) {
    now.textContent = "a rule is broken — look for the highlighted cells";
    now.className = "now bad";
  } else {
    now.textContent = `${ev.unknownCount} cells to fill`;
    now.className = "now";
  }
  $("diff").textContent = `difficulty ${p.scalar}`;
}

function onCell(cell: number): void {
  const s = st;
  if (!s || s.solveMs !== null) return;
  const cur = s.committed[cell];
  s.committed[cell] = cur === U ? 1 : cur === 1 ? 0 : U; // empty → ● → ○ → empty
  render();
}

if (typeof document !== "undefined") {
  $("new").addEventListener("click", newGame);
  newGame();
}
