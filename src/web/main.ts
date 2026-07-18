// Fumbo knot inspector (Phase 1 review harness — NOT the Phase 2 tactile
// prototype). Runs the pure engine in the browser: generate a knot, assert
// threads by clicking, watch forced consequences cascade and contradictions
// localize, and time each solve. Solve times persist to localStorage — the same
// "track solve time" concept the game session will own later.

import { CType, isCountType, puzzleDigest, type Constraint, type WirePuzzle } from "../core/index.js";
import { firstViolated, solve } from "../solver/index.js";
import { generate, LADDER, type TargetTier } from "../gen/index.js";
import { layout, type Pt } from "./layout.js";
import { sigilSvg } from "./sigil.js";

const U = -1;

interface State {
  tier: TargetTier;
  wp: WirePuzzle;
  solution: bigint;
  difficulty: { maxTier: number; scalar: number; steps: number; hypoCount: number; threadCount: number };
  pts: Pt[];
  anchors: Set<number>;
  committed: Int8Array; // anchors + player assertions; -1 elsewhere
  startMs: number;
  solveMs: number | null;
  hintConstraint: number | null;
}

let state: State | null = null;
const $ = <T extends Element>(id: string): T => document.getElementById(id) as unknown as T;
const svg = $<SVGSVGElement>("knot");
const VB = 600;

// ── setup ────────────────────────────────────────────────────────────────────

function buildTierButtons(): void {
  const host = $("tiers");
  const names: Record<TargetTier, string> = { 1: "t1", 2: "t2", 3: "t3", 4: "t4" };
  host.innerHTML = "";
  for (const t of [1, 2, 3, 4] as TargetTier[]) {
    const b = document.createElement("button");
    b.textContent = names[t];
    b.setAttribute("aria-pressed", String(state?.tier === t));
    b.addEventListener("click", () => newKnot(t));
    host.appendChild(b);
  }
}

function newKnot(tier: TargetTier): void {
  const seed = (Math.floor(Math.random() * 0xffffffff) ^ 0x9e3779b9) >>> 0;
  let r = generate(LADDER[tier], seed);
  // Rejection sampling can miss within budget for a single seed; retry a few.
  for (let i = 0; !r.ok && i < 5; i++) r = generate(LADDER[tier], (seed + i * 2654435761) >>> 0);
  if (!r.ok) {
    $("stateNow").textContent = "generation stalled — try again";
    return;
  }
  const p = r.puzzle;
  const wp: WirePuzzle = { threadCount: p.threads.length, layoutSeed: p.layoutSeed, constraints: [...p.constraints], solution: p.solution };
  const anchors = new Set<number>();
  const committed = new Int8Array(wp.threadCount).fill(U);
  for (const c of wp.constraints) {
    if (c.type === CType.ANCHOR) {
      anchors.add(c.threads[0]!);
      committed[c.threads[0]!] = (c.k ?? 0) as 0 | 1;
    }
  }
  state = {
    tier,
    wp,
    solution: p.solution,
    difficulty: p.difficulty,
    pts: layout(wp.threadCount, wp.constraints, wp.layoutSeed),
    anchors,
    committed,
    startMs: performance.now(),
    solveMs: null,
    hintConstraint: null,
  };
  $("sigilPanel").classList.remove("show");
  $("timerSub").textContent = "solving";
  ($("timer") as HTMLElement).classList.remove("solved");
  buildTierButtons();
  render();
}

// ── evaluation ───────────────────────────────────────────────────────────────

interface Eval {
  derived: Int8Array;
  violated: number; // constraint index or -1
  solved: boolean;
  unknownCount: number;
}

function evaluate(s: State): Eval {
  // No auto-derivation: the player does the deducing. Propagating the forced
  // closure here would solve the puzzle instantly (every puzzle is deducible at
  // tier ≤2 from its anchors). We only validate the player's partial assignment
  // and localize the first contradiction — honest information a reasoner has.
  const derived = s.committed.slice();
  const violated = firstViolated(s.wp.constraints, derived);
  let unknownCount = 0;
  for (let i = 0; i < derived.length; i++) if (derived[i] === U) unknownCount++;
  const solved = unknownCount === 0 && violated === -1;
  return { derived, violated, solved, unknownCount };
}

function threadClass(i: number, s: State, ev: Eval): { value: number; kind: "anchor" | "player" | "derived" | "unknown" } {
  if (s.anchors.has(i)) return { value: s.committed[i]!, kind: "anchor" };
  if (s.committed[i] !== U) return { value: s.committed[i]!, kind: "player" };
  if (ev.derived[i] !== U) return { value: ev.derived[i]!, kind: "derived" };
  return { value: U, kind: "unknown" };
}

// ── rendering ────────────────────────────────────────────────────────────────

function P(i: number, s: State): { x: number; y: number } {
  return { x: s.pts[i]!.x * VB, y: s.pts[i]!.y * VB };
}

function colorFor(value: number, kind: string): string {
  if (kind === "anchor") return "var(--anchor)";
  if (value === 1) return "var(--true)";
  if (value === 0) return "var(--false)";
  return "var(--unknown)";
}

function render(): void {
  const s = state;
  if (!s) return;
  const ev = evaluate(s);

  // constraint strands (behind the threads)
  const strands: string[] = [];
  s.wp.constraints.forEach((c, ci) => {
    if (c.type === CType.ANCHOR) return;
    const strain = ci === ev.violated;
    const hint = ci === s.hintConstraint;
    const col = strain ? "var(--strain)" : hint ? "var(--anchor)" : "var(--ink-faint)";
    const w = strain || hint ? 2.4 : 1.2;
    const op = strain || hint ? 0.9 : 0.5;
    const pairs: [number, number][] = isCountType(c.type)
      ? c.threads.slice(1).map((t) => [c.threads[0]!, t])
      : [[c.threads[0]!, c.threads[1]!]];
    for (const [a, b] of pairs) {
      const pa = P(a, s);
      const pb = P(b, s);
      // bow the strand toward the knot centroid so crossings read as a knot
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2;
      const cx = mx + (VB / 2 - mx) * 0.25;
      const cy = my + (VB / 2 - my) * 0.25;
      const cls = hint ? ' class="hintstrand"' : "";
      strands.push(`<path${cls} d="M ${pa.x.toFixed(1)} ${pa.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${pb.x.toFixed(1)} ${pb.y.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}"/>`);
    }
  });

  // threads (orbs)
  const orbs: string[] = [];
  for (let i = 0; i < s.wp.threadCount; i++) {
    const { value, kind } = threadClass(i, s, ev);
    const p = P(i, s);
    const col = colorFor(value, kind);
    const isTrue = value === 1;
    const strained = ev.violated !== -1 && s.wp.constraints[ev.violated]!.threads.includes(i);
    const rOuter = kind === "anchor" ? 15 : isTrue ? 13 : 10;
    // Only taut (true) threads and true anchors glow; false is slack/dim.
    const glow = value === 1 ? 1 : 0;
    const clickable = !s.anchors.has(i);
    const halo = glow ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rOuter + 10}" fill="${col}" opacity="0.14"/>` : "";
    const ring = kind === "derived" ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rOuter + 4}" fill="none" stroke="${col}" stroke-width="1" opacity="0.4"/>` : "";
    const cx = p.x.toFixed(1);
    const cy = p.y.toFixed(1);
    let shape: string;
    if (kind === "anchor") {
      const x = (p.x - rOuter).toFixed(1);
      const y = (p.y - rOuter).toFixed(1);
      const d = (rOuter * 2).toFixed(1);
      // true anchor: filled+taut; false anchor: hollow outline (slack, pinned).
      shape =
        value === 1
          ? `<rect x="${x}" y="${y}" width="${d}" height="${d}" rx="3" fill="var(--anchor)" opacity="0.95"/>`
          : `<rect x="${x}" y="${y}" width="${d}" height="${d}" rx="3" fill="var(--field)" stroke="var(--anchor)" stroke-width="2" opacity="0.85"/>`;
    } else {
      shape = `<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="${col}" opacity="${isTrue ? 0.95 : kind === "unknown" ? 0.55 : 0.8}"/>`;
    }
    const strainRing = strained ? `<circle cx="${cx}" cy="${cy}" r="${rOuter + 7}" fill="none" stroke="var(--strain)" stroke-width="1.5" opacity="0.8"/>` : "";
    const labelDark = value === 1; // dark ink only on bright fills
    const labelCol = labelDark ? "#0a0e14" : kind === "anchor" ? "var(--anchor)" : "var(--ink-dim)";
    const label = `<text x="${cx}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="${labelCol}" pointer-events="none">${i}</text>`;
    orbs.push(
      `<g class="thread" data-i="${i}" style="cursor:${clickable ? "pointer" : "default"}">${halo}${ring}${strainRing}${shape}${label}</g>`,
    );
  }

  svg.innerHTML = `<g>${strands.join("")}</g><g>${orbs.join("")}</g>`;
  svg.querySelectorAll<SVGGElement>(".thread").forEach((g) => {
    g.addEventListener("click", () => onThreadClick(Number(g.dataset.i)));
  });

  renderRules(s, ev);
  renderStatus(s, ev);
  if (ev.solved && s.solveMs === null) onSolved(s);
}

function onThreadClick(i: number): void {
  const s = state;
  if (!s || s.solveMs !== null) return;
  if (s.anchors.has(i)) return; // anchors are given, not interactive
  // cycle unknown → true → false → unknown (RETRACT is the wrap back to unknown)
  const cur = s.committed[i];
  s.committed[i] = cur === U ? 1 : cur === 1 ? 0 : U;
  s.hintConstraint = null;
  render();
}

function renderRules(s: State, ev: Eval): void {
  const host = $("rules");
  const rows: string[] = [];
  s.wp.constraints.forEach((c, ci) => {
    const cls = ci === ev.violated ? "rule strain" : ci === s.hintConstraint ? "rule hint" : "rule";
    rows.push(`<div class="${cls}"><span class="tid">${String(ci).padStart(2)}</span><span>${phrase(c)}</span></div>`);
  });
  host.innerHTML = rows.join("");
}

function phrase(c: Constraint): string {
  const T = (i: number) => `#${i}`;
  const list = (ts: readonly number[]) => ts.map(T).join(", ");
  switch (c.type) {
    case CType.ANCHOR: return `<span class="given">${T(c.threads[0]!)} is ${c.k === 1 ? "true" : "false"}</span>`;
    case CType.IMPL: return `${T(c.threads[0]!)} true &rarr; ${T(c.threads[1]!)} true`;
    case CType.XOR: return `exactly one of ${list(c.threads)}`;
    case CType.NAND: return `not both ${list(c.threads)}`;
    case CType.OR: return `at least one of ${list(c.threads)}`;
    case CType.EQUIV: return `${T(c.threads[0]!)} same as ${T(c.threads[1]!)}`;
    case CType.COUNT_EQ: return `exactly ${c.k} of {${list(c.threads)}}`;
    case CType.COUNT_LE: return `at most ${c.k} of {${list(c.threads)}}`;
    case CType.COUNT_GE: return `at least ${c.k} of {${list(c.threads)}}`;
  }
  return "";
}

function renderStatus(s: State, ev: Eval): void {
  const now = $("stateNow");
  if (ev.solved) {
    now.textContent = "solved";
    now.className = "now solved";
  } else if (ev.violated !== -1) {
    now.textContent = `strained at rule ${ev.violated}`;
    now.className = "now strain";
  } else {
    now.textContent = `${ev.unknownCount} thread${ev.unknownCount === 1 ? "" : "s"} unresolved`;
    now.className = "now";
  }
  const d = s.difficulty;
  $("vec").innerHTML =
    `<dt>threads</dt><dd>${d.threadCount}</dd>` +
    `<dt>max tier</dt><dd>${d.maxTier}</dd>` +
    `<dt>steps</dt><dd>${d.steps}</dd>` +
    `<dt>tests needed</dt><dd>${d.hypoCount}</dd>` +
    `<dt>scalar</dt><dd>${d.scalar}</dd>`;
}

// ── hint / reveal / solve ────────────────────────────────────────────────────

function doHint(): void {
  const s = state;
  if (!s || s.solveMs !== null) return;
  const r = solve(s.wp.threadCount, s.wp.constraints, { tierCeiling: 4, initial: s.committed });
  const next = r.trace.find((st) => evaluate(s).derived[st.thread] === U);
  s.hintConstraint = next ? next.constraint : null;
  if (next && next.constraint === -1) {
    $("stateNow").textContent = `try a hypothesis on #${next.thread}`;
  }
  render();
}

function doReveal(): void {
  const s = state;
  if (!s) return;
  for (let i = 0; i < s.wp.threadCount; i++) s.committed[i] = Number((s.solution >> BigInt(i)) & 1n) as 0 | 1;
  s.hintConstraint = null;
  render();
}

function onSolved(s: State): void {
  s.solveMs = Math.round(performance.now() - s.startMs);
  ($("timer") as HTMLElement).classList.add("solved");
  $("timerSub").textContent = "solved";
  recordSolve(s);
  // collapse → sigil
  const digest = puzzleDigest(s.wp.threadCount, s.wp.constraints);
  const sig = $("sigil");
  sig.innerHTML = sigilSvg({ digest, threadCount: s.wp.threadCount, maxTier: s.difficulty.maxTier, scalar: s.difficulty.scalar }, "var(--true)");
  $("sigilTime").textContent = fmtTime(s.solveMs);
  const testTxt = s.difficulty.hypoCount > 0 ? `${s.difficulty.hypoCount} test${s.difficulty.hypoCount === 1 ? "" : "s"}` : "no tests";
  $("sigilSig").textContent = `t${s.tier} · ${fmtTime(s.solveMs)} · ${testTxt}`;
  setTimeout(() => $("sigilPanel").classList.add("show"), 320);
}

// ── solve-time log (localStorage) ────────────────────────────────────────────

interface LogEntry { ts: number; tier: number; scalar: number; solveMs: number; threads: number }
const LOG_KEY = "fmb_solvelog";

function recordSolve(s: State): void {
  try {
    const log: LogEntry[] = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
    log.push({ ts: Date.now(), tier: s.tier, scalar: s.difficulty.scalar, solveMs: s.solveMs!, threads: s.wp.threadCount });
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* private mode / storage disabled — timing still shows this session */
  }
}

// ── timer tick ───────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

function tick(): void {
  const s = state;
  const el = $("timer") as HTMLElement;
  if (s) {
    const ms = s.solveMs ?? performance.now() - s.startMs;
    const sec = ms / 1000;
    el.innerHTML = sec < 60 ? `${sec.toFixed(1)}<span style="font-size:20px">s</span>` : fmtTime(ms);
  }
  requestAnimationFrame(tick);
}

// ── boot ─────────────────────────────────────────────────────────────────────

$("btnNew").addEventListener("click", () => newKnot(state?.tier ?? 2));
$("btnHint").addEventListener("click", doHint);
$("btnReveal").addEventListener("click", doReveal);
buildTierButtons();
newKnot(2);
requestAnimationFrame(tick);
