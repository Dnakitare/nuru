// The minesweeper game surface. Runs the seeded engine generator so the Daily
// board is the same for everyone and reproducible; a solved board collapses into
// the deterministic sigil (carried over from the knot) as the reward + share
// mark. Pure deduction: firstViolated localizes a wrong mark, and every board is
// guaranteed solvable without a guess.

import { puzzleDigest, type Constraint } from "../../core/index.js";
import { firstViolated } from "../../solver/index.js";
import { dailySeed, genMinesweeper, type MinesBoard, type MinesOpts } from "../../gen/index.js";
import { sigilSvg } from "../sigil.js";

const U = -1;
const $ = (id: string) => document.getElementById(id)!;

const PRESETS: Record<string, MinesOpts> = {
  easy: { rows: 6, cols: 5, density: 0.24 },
  medium: { rows: 8, cols: 7, density: 0.28 },
  hard: { rows: 10, cols: 8, density: 0.3 },
};
const DAILY_OPTS = PRESETS.medium!;
const DAILY_EPOCH = Date.UTC(2026, 0, 1); // daily #1 = 2026-01-01
const STORE = "fmb_ms_daily";

interface State {
  mode: "daily" | "practice";
  preset: string;
  board: MinesBoard;
  committed: Int8Array; // -1 unknown, 1 mine, 0 clear
  startMs: number;
  solveMs: number | null;
  dayNo: number;
}
let st: State | null = null;

function todayUTC(): { y: number; m: number; d: number; dayNo: number } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  const dayNo = Math.floor((Date.UTC(y, m - 1, d) - DAILY_EPOCH) / 86400000) + 1;
  return { y, m, d, dayNo };
}

function newBoard(mode: "daily" | "practice", preset: string): void {
  const t = todayUTC();
  const opts = mode === "daily" ? DAILY_OPTS : PRESETS[preset]!;
  const seed = mode === "daily" ? dailySeed(t.y, t.m, t.d) : (Math.floor(Math.random() * 0xffffffff) ^ 0x9e3779b9) >>> 0;
  const board = genMinesweeper(seed, opts);
  const committed = new Int8Array(board.rows * board.cols).fill(U);
  for (const cl of board.clues) committed[cl.cell] = 0;
  st = { mode, preset, board, committed, startMs: performance.now(), solveMs: null, dayNo: t.dayNo };
  $("sigilPanel").classList.remove("show");
  render();

  // if the daily was already solved today, restore the finished state
  if (mode === "daily") {
    try {
      const rec = JSON.parse(localStorage.getItem(STORE) ?? "null");
      if (rec && rec.dayNo === t.dayNo && rec.solveMs != null) {
        for (let i = 0; i < board.mine.length; i++) committed[i] = board.mine[i]!;
        st.solveMs = rec.solveMs;
        render();
        showWin(true);
      }
    } catch {
      /* storage disabled */
    }
  }
}

function clueAt(b: MinesBoard, cell: number): number | null {
  for (const c of b.clues) if (c.cell === cell) return c.k;
  return null;
}

function evaluateBoard(): { violated: number; solved: boolean; unknown: number } {
  const s = st!;
  const violated = firstViolated(s.board.constraints, s.committed);
  let unknown = 0;
  for (let i = 0; i < s.committed.length; i++) if (s.committed[i] === U) unknown++;
  return { violated, solved: unknown === 0 && violated === -1, unknown };
}

function ownerCell(ci: number): number {
  const c = st!.board.constraints[ci] as Constraint | undefined;
  if (!c) return -1;
  // clue COUNT is preceded by its ANCHOR on the clue cell; ANCHOR is the owner
  return c.type === 0 ? c.threads[0]! : st!.board.constraints[ci - 1]?.threads[0] ?? -1;
}

function render(): void {
  const s = st;
  if (!s) return;
  const { board } = s;
  const ev = evaluateBoard();
  const violatedCell = ev.violated >= 0 ? ownerCell(ev.violated) : -1;

  // fit the hex board to the available width
  const wrap = $("boardwrap");
  const avail = Math.min(wrap.clientWidth || 440, 460);
  const W = Math.min(54, Math.floor(avail / (board.cols + 0.5)));
  const H = Math.round(W * 0.9);
  const board$ = $("board");
  board$.innerHTML = "";
  board$.style.width = `${board.cols * W + W / 2}px`;
  board$.style.height = `${board.rows * (H - 6) + 12}px`;

  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const cell = r * board.cols + c;
      const el = document.createElement("button");
      el.className = "hex";
      el.style.width = `${W}px`;
      el.style.height = `${H}px`;
      el.style.left = `${c * W + (r & 1 ? W / 2 : 0)}px`;
      el.style.top = `${r * (H - 6)}px`;
      el.style.fontSize = `${Math.round(W * 0.36)}px`;
      const k = clueAt(board, cell);
      if (k !== null) {
        el.classList.add("clue");
        el.textContent = String(k);
        el.disabled = true;
      } else {
        const v = s.committed[cell];
        el.classList.add(v === 1 ? "mine" : v === 0 ? "safe" : "unknown");
        if (s.solveMs === null) el.addEventListener("click", () => onCell(cell));
        else el.disabled = true;
      }
      if (cell === violatedCell) el.classList.add("strain");
      board$.appendChild(el);
    }
  }

  let marked = 0;
  for (const v of s.committed) if (v === 1) marked++;
  $("mines").textContent = String(board.mineCount - marked);
  const now = $("now");
  if (ev.solved && s.solveMs === null) {
    onWin();
  } else if (ev.violated >= 0) {
    now.textContent = "a number is contradicted — undo a mark";
    now.className = "now bad";
  } else if (s.solveMs !== null) {
    now.textContent = "";
  } else {
    now.textContent = `${ev.unknown} cells to resolve`;
    now.className = "now";
  }
}

function onCell(cell: number): void {
  const s = st;
  if (!s || s.solveMs !== null) return;
  const cur = s.committed[cell];
  s.committed[cell] = cur === U ? 1 : cur === 1 ? 0 : U; // unknown → mine → clear → unknown
  render();
}

function onWin(): void {
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
  showWin(false);
}

function fmtTime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function showWin(replay: boolean): void {
  const s = st!;
  const b = s.board;
  const digest = puzzleDigest(b.rows * b.cols, b.constraints);
  $("sigil").innerHTML = sigilSvg({ digest, threadCount: b.rows * b.cols, maxTier: b.difficulty.maxTier, scalar: b.difficulty.scalar }, "var(--accent)");
  const label = s.mode === "daily" ? `daily #${s.dayNo}` : `${s.preset}`;
  $("winTime").textContent = fmtTime(s.solveMs ?? 0);
  $("winSig").textContent = `${label} · ${fmtTime(s.solveMs ?? 0)} · no guesses`;
  $("winLead").textContent = replay ? "already solved today" : "solved";
  ($("winShare") as HTMLButtonElement).onclick = () => share();
  $("sigilPanel").classList.add("show");
}

function share(): void {
  const s = st!;
  const label = s.mode === "daily" ? `daily #${s.dayNo}` : "practice";
  const text = `fumbo minesweeper ${label}\n${fmtTime(s.solveMs ?? 0)} · no guesses ✦\n${location.origin}/mines.html`;
  const btn = $("winShare");
  navigator.clipboard?.writeText(text).then(
    () => {
      btn.textContent = "copied";
      setTimeout(() => (btn.textContent = "share"), 1400);
    },
    () => {},
  );
}

// ── controls ─────────────────────────────────────────────────────────────────

function setMode(mode: "daily" | "practice"): void {
  const preset = st?.preset ?? "medium";
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.classList.toggle("on", t.dataset.mode === mode));
  ($("presets") as HTMLElement).style.visibility = mode === "practice" ? "visible" : "hidden";
  newBoard(mode, preset);
}

function timer(): void {
  const s = st;
  if (s) $("timer").textContent = fmtTime(s.solveMs ?? performance.now() - s.startMs);
  requestAnimationFrame(timer);
}

if (typeof document !== "undefined") {
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode as "daily" | "practice")));
  document.querySelectorAll<HTMLElement>(".preset").forEach((p) =>
    p.addEventListener("click", () => {
      document.querySelectorAll(".preset").forEach((x) => x.classList.remove("on"));
      p.classList.add("on");
      newBoard("practice", p.dataset.preset!);
    }),
  );
  $("again").addEventListener("click", () => newBoard(st?.mode ?? "daily", st?.preset ?? "medium"));
  setMode("daily");
  requestAnimationFrame(timer);
}
