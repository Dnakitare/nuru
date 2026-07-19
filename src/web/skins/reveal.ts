// "Reveal" game surface — deduce a hidden symmetric glyph. Dark luminous field:
// lit cells glow, and the solved board IS the reward (a rune emerges). Runs the
// seeded engine generator so the daily glyph is shared + reproducible.

import { type Constraint } from "../../core/index.js";
import { firstViolated } from "../../solver/index.js";
import { genReveal, revealDailySeed, type RevealBoard, type RevealOpts } from "../../gen/index.js";

const U = -1;
const $ = (id: string) => document.getElementById(id)!;
const OPTS: RevealOpts = { rows: 6, cols: 6 };
const EPOCH = Date.UTC(2026, 0, 1);
const STORE = "fmb_reveal_daily";

interface State {
  mode: "daily" | "practice";
  board: RevealBoard;
  committed: Int8Array; // -1 unknown, 1 lit, 0 dark
  startMs: number;
  solveMs: number | null;
  dayNo: number;
}
let st: State | null = null;

function today(): { seed: number; dayNo: number } {
  const d = new Date();
  const seed = revealDailySeed(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const dayNo = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH) / 86400000) + 1;
  return { seed, dayNo };
}

function newGame(mode: "daily" | "practice"): void {
  const t = today();
  const seed = mode === "daily" ? t.seed : (Math.floor(Math.random() * 0xffffffff) ^ 0x9e3779b9) >>> 0;
  const board = genReveal(seed, OPTS);
  const committed = new Int8Array(board.rows * board.cols).fill(U);
  for (const g of board.givens) committed[g.cell] = g.v;
  st = { mode, board, committed, startMs: performance.now(), solveMs: null, dayNo: t.dayNo };
  render();
  if (mode === "daily") {
    try {
      const rec = JSON.parse(localStorage.getItem(STORE) ?? "null");
      if (rec && rec.dayNo === t.dayNo && rec.solveMs != null) {
        for (let i = 0; i < board.sol.length; i++) committed[i] = board.sol[i]!;
        st.solveMs = rec.solveMs;
        render();
        finish(true);
      }
    } catch {
      /* storage disabled */
    }
  }
}

function evalBoard(): { violated: number; solved: boolean; unknown: number } {
  const s = st!;
  const violated = firstViolated(s.board.constraints, s.committed);
  let unknown = 0;
  for (const v of s.committed) if (v === U) unknown++;
  return { violated, solved: unknown === 0 && violated === -1, unknown };
}

const CELL = 50;
const GAP = 6;
const PAD = 30; // room for edge count labels

function render(): void {
  const s = st;
  if (!s) return;
  const { board, committed } = s;
  const ev = evalBoard();
  const strained = new Set<number>();
  if (ev.violated >= 0) for (const c of (board.constraints[ev.violated] as Constraint).threads) strained.add(c);

  const wrap = $("board");
  wrap.innerHTML = "";
  const span = (n: number) => PAD + n * (CELL + GAP);
  wrap.style.width = wrap.style.height = `${PAD + board.cols * (CELL + GAP)}px`;

  // lit counts per line (for satisfied-count dimming)
  const rowLit = new Array(board.rows).fill(0);
  const colLit = new Array(board.cols).fill(0);
  for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) if (committed[r * board.cols + c] === 1) { rowLit[r]++; colLit[c]++; }

  // edge count labels
  for (let r = 0; r < board.rows; r++) {
    const lab = document.createElement("div");
    lab.className = "count" + (rowLit[r] === board.rowCounts[r] ? " done" : "");
    lab.style.left = "0px";
    lab.style.top = `${span(r)}px`;
    lab.style.width = `${PAD - 6}px`;
    lab.style.height = `${CELL}px`;
    lab.textContent = String(board.rowCounts[r]);
    wrap.appendChild(lab);
  }
  for (let c = 0; c < board.cols; c++) {
    const lab = document.createElement("div");
    lab.className = "count col" + (colLit[c] === board.colCounts[c] ? " done" : "");
    lab.style.left = `${span(c)}px`;
    lab.style.top = "0px";
    lab.style.width = `${CELL}px`;
    lab.style.height = `${PAD - 6}px`;
    lab.textContent = String(board.colCounts[c]);
    wrap.appendChild(lab);
  }

  // cells
  const givenCells = new Set(board.givens.map((g) => g.cell));
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const cell = r * board.cols + c;
      const el = document.createElement("button");
      const v = committed[cell];
      el.className = "cell " + (v === 1 ? "lit" : v === 0 ? "dark" : "unknown");
      if (givenCells.has(cell)) el.classList.add("given");
      if (strained.has(cell)) el.classList.add("strain");
      if (s.solveMs !== null && v === 1) el.classList.add("reveal");
      el.style.left = `${span(c)}px`;
      el.style.top = `${span(r)}px`;
      el.style.width = el.style.height = `${CELL}px`;
      if (s.solveMs === null && !givenCells.has(cell)) el.addEventListener("click", () => onCell(cell));
      else el.disabled = true;
      wrap.appendChild(el);
    }
  }

  // relational link badges between adjacent cells
  for (const lk of board.links) {
    const ar = Math.floor(lk.a / board.cols);
    const ac = lk.a % board.cols;
    const br = Math.floor(lk.b / board.cols);
    const bc = lk.b % board.cols;
    const b = document.createElement("div");
    b.className = "link" + (lk.eq ? " eq" : " xor");
    b.style.left = `${(span(ac) + span(bc)) / 2 + CELL / 2}px`;
    b.style.top = `${(span(ar) + span(br)) / 2 + CELL / 2}px`;
    b.textContent = lk.eq ? "=" : "×";
    wrap.appendChild(b);
  }

  const now = $("now");
  if (ev.solved && s.solveMs === null) {
    onSolved();
  } else if (ev.violated >= 0) {
    now.textContent = "a clue is broken";
    now.className = "now bad";
  } else if (s.solveMs !== null) {
    now.textContent = "";
  } else {
    now.textContent = `${ev.unknown} cells to decide`;
    now.className = "now";
  }
}

function onCell(cell: number): void {
  const s = st;
  if (!s || s.solveMs !== null) return;
  const cur = s.committed[cell];
  s.committed[cell] = cur === U ? 1 : cur === 1 ? 0 : U; // unknown → lit → dark → unknown
  render();
}

function onSolved(): void {
  const s = st!;
  s.solveMs = Math.round(performance.now() - s.startMs);
  if (s.mode === "daily") {
    try {
      localStorage.setItem(STORE, JSON.stringify({ dayNo: s.dayNo, solveMs: s.solveMs }));
    } catch {
      /* ignore */
    }
  }
  render();
  finish(false);
}

function fmtTime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function finish(replay: boolean): void {
  const s = st!;
  const label = s.mode === "daily" ? `glyph #${s.dayNo}` : "practice";
  $("won").style.display = "block";
  $("wonText").textContent = `${replay ? "revealed earlier" : "revealed"} · ${label} · ${fmtTime(s.solveMs ?? 0)} · no guesses`;
  ($("share") as HTMLButtonElement).onclick = () => {
    const text = `fumbo · ${label}\n${fmtTime(s.solveMs ?? 0)} · no guesses ✦\n${location.origin}/reveal.html`;
    navigator.clipboard?.writeText(text).then(() => {
      $("share").textContent = "copied";
      setTimeout(() => ($("share").textContent = "share"), 1400);
    });
  };
}

function timer(): void {
  const s = st;
  if (s) $("timer").textContent = fmtTime(s.solveMs ?? performance.now() - s.startMs);
  requestAnimationFrame(timer);
}

if (typeof document !== "undefined") {
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("on"));
      t.classList.add("on");
      $("won").style.display = "none";
      newGame(t.dataset.mode as "daily" | "practice");
    }),
  );
  $("again").addEventListener("click", () => {
    $("won").style.display = "none";
    newGame(st?.mode ?? "daily");
  });
  newGame("daily");
  requestAnimationFrame(timer);
}
