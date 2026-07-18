// Fumbo knot inspector (Phase 1 review harness — NOT the Phase 2 tactile
// prototype). Runs the pure engine in the browser: generate a knot, assert
// threads by clicking, watch forced consequences cascade and contradictions
// localize, and time each solve. Solve times persist to localStorage — the same
// "track solve time" concept the game session will own later.

import { CType, isCountType, puzzleDigest, type Constraint, type WirePuzzle } from "../core/index.js";
import { firstViolated, Rule, solve } from "../solver/index.js";
import { generate, LADDER, type TargetTier } from "../gen/index.js";
import { layout, type Pt } from "./layout.js";
import { sigilSvg } from "./sigil.js";
import { runWalkthrough, type WalkStep } from "./walkthrough.js";

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
    b.addEventListener("click", () => {
      stopDemo();
      newKnot(t);
    });
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
    let shape = "";
    let anchorCaption = "";
    if (kind === "anchor") {
      const x = (p.x - rOuter).toFixed(1);
      const y = (p.y - rOuter).toFixed(1);
      const d = (rOuter * 2).toFixed(1);
      // true anchor: filled bright amber + glow (taut). false anchor: dim "off"
      // fill with an amber outline (slack, pinned) — clearly filled-but-off, not
      // an empty node.
      shape =
        value === 1
          ? `<rect x="${x}" y="${y}" width="${d}" height="${d}" rx="3" fill="var(--anchor)" opacity="0.96"/>`
          : `<rect x="${x}" y="${y}" width="${d}" height="${d}" rx="3" fill="#241d0f" stroke="var(--anchor)" stroke-width="2" opacity="0.9"/>`;
      // explicit state caption below every anchor — removes all ambiguity
      const capY = (p.y + rOuter + 14).toFixed(1);
      anchorCaption = `<text x="${cx}" y="${capY}" text-anchor="middle" font-family="var(--mono)" font-size="10" letter-spacing="0.1em" fill="var(--anchor)" opacity="${value === 1 ? 0.95 : 0.72}" pointer-events="none">given ${value === 1 ? "true" : "false"}</text>`;
    } else {
      shape = `<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="${col}" opacity="${isTrue ? 0.95 : kind === "unknown" ? 0.55 : 0.8}"/>`;
    }
    const strainRing = strained ? `<circle cx="${cx}" cy="${cy}" r="${rOuter + 7}" fill="none" stroke="var(--strain)" stroke-width="1.5" opacity="0.8"/>` : "";
    // dark ink on the bright true-anchor fill; amber on the dim false-anchor fill
    const labelCol = value === 1 ? "#0a0e14" : kind === "anchor" ? "var(--anchor)" : "var(--ink-dim)";
    const label = `<text x="${cx}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="${labelCol}" pointer-events="none">${i}</text>`;
    orbs.push(
      `<g class="thread" data-i="${i}" style="cursor:${clickable ? "pointer" : "default"}">${halo}${ring}${strainRing}${shape}${label}${anchorCaption}</g>`,
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
  stopDemo();
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
  stopDemo();
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
  stopDemo();
  const s = state;
  if (!s) return;
  for (let i = 0; i < s.wp.threadCount; i++) s.committed[i] = Number((s.solution >> BigInt(i)) & 1n) as 0 | 1;
  s.hintConstraint = null;
  render();
}

// ── guided solve demo ────────────────────────────────────────────────────────
// Replays the solver's canonical trace one inference at a time — highlight the
// reason (the crossing), then settle the forced thread — so a first-time viewer
// learns the verb: rules force threads, threads cascade, the knot collapses.

let demoToken = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function stopDemo(): void {
  demoToken++;
  $("demoBar").classList.remove("show");
}

function narrate(step: { rule: number; constraint: number; thread: number; value: number }, cs: readonly Constraint[]): string {
  const t = `#${step.thread}`;
  const v = step.value === 1 ? "taut (true)" : "slack (false)";
  if (step.constraint === -1) {
    return `<span class="lead">a test:</span> assuming ${t} the other way forces a contradiction &mdash; so ${t} goes ${v}`;
  }
  return `<span class="lead">${phrase(cs[step.constraint]!)}</span> &rArr; ${t} goes ${v}`;
}

async function runDemo(fresh: boolean): Promise<void> {
  const my = ++demoToken;
  if (fresh || !state) newKnot(state?.tier ?? 2);
  const s = state;
  if (!s) return;
  // reset to the givens only, then replay from the top
  for (let i = 0; i < s.wp.threadCount; i++) if (!s.anchors.has(i)) s.committed[i] = U;
  s.solveMs = null;
  s.startMs = performance.now();
  s.hintConstraint = null;
  $("sigilPanel").classList.remove("show");
  ($("timer") as HTMLElement).classList.remove("solved");
  $("timerSub").textContent = "watching";
  render();

  const full = solve(s.wp.threadCount, s.wp.constraints, { tierCeiling: 4 });
  const steps = full.trace.filter((st) => st.rule !== Rule.R0); // givens are already lit
  const bar = $("demoBar");
  bar.classList.add("show");
  bar.innerHTML = `<span class="lead">the givens are pinned.</span> each rule below forces one more thread.`;
  await sleep(1400);
  if (my !== demoToken) return;

  for (const st of steps) {
    // 1. point at the reason
    s.hintConstraint = st.constraint;
    render();
    bar.innerHTML = narrate(st, s.wp.constraints);
    await sleep(820);
    if (my !== demoToken) return;
    // 2. settle the forced thread
    s.committed[st.thread] = st.value as 0 | 1;
    s.hintConstraint = null;
    render();
    await sleep(430);
    if (my !== demoToken) return;
  }
  bar.classList.remove("show");
  // render() during the final step already triggered the collapse-to-sigil
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

$("btnNew").addEventListener("click", () => {
  stopDemo();
  newKnot(state?.tier ?? 2);
});
$("btnDemo").addEventListener("click", () => void runDemo(true));
$("btnHint").addEventListener("click", doHint);
$("btnReveal").addEventListener("click", doReveal);
$("btnGuide").addEventListener("click", startWalkthrough);

const WALK: WalkStep[] = [
  {
    title: "fumbo",
    body: "a knot of claims. every thread is a statement that is either true or false. your job is to work out which, using only the rules.",
  },
  {
    title: "the threads",
    target: "#knot",
    body: "each node in the knot is one claim. dim and drifting means undecided, which is most of them to start.",
  },
  {
    title: "the givens",
    target: "#knot",
    body: "the amber pinned nodes are handed to you. a filled pin is given true, a hollow one is given false. they are your way in.",
  },
  {
    title: "make a claim",
    target: "#knot",
    body: "click a thread to pull it taut (true). click again for slack (false). once more to let it go. trying costs nothing.",
  },
  {
    title: "when claims collide",
    target: "#knot",
    body: "assert something inconsistent and the knot strains red at the exact rule that broke. that shows you where, not that you failed.",
  },
  {
    title: "the reasons",
    target: "#rules",
    body: "these rules bind the threads together. every step of a solve follows from one of them. nothing here needs a guess.",
  },
  {
    title: "the finish",
    target: "#timer",
    body: "resolve every thread with no strain and the knot collapses into a sigil, and your time is kept. stuck along the way? hint points at the next rule to use.",
  },
];

function startWalkthrough(): void {
  stopDemo();
  runWalkthrough(WALK, { onWatch: () => void runDemo(true) });
}

buildTierButtons();
newKnot(2);
// First-ever visit: walk through the concept before anything is touched.
let onboarded = false;
try {
  onboarded = localStorage.getItem("fmb_onboarded") === "1";
  localStorage.setItem("fmb_onboarded", "1");
} catch {
  /* storage disabled */
}
if (!onboarded) startWalkthrough();
requestAnimationFrame(tick);
