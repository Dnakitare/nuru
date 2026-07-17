// SPEC-GENERATOR §3 — the deduction-only solver. Tier-ordered greedy: at each
// step apply the FIRST available rule application (lowest tier wins, ties broken
// by constraint index, then thread id). The recorded sequence is the CANONICAL
// TRACE — the single source of truth for grading (gen/grade) and the
// deducibility certificate. Determinism here is a contract: solver ports must
// reproduce traces exactly (TESTING §1 solve vectors).
//
// Zero DOM, zero imports outside core/. Runs in Node and browser identically.

import { CType, isCountType, type Constraint } from "../core/types.js";
import { sha256Hex } from "../core/sha256.js";
import { Rule, tierOf } from "./rules.js";

const U = -1; // UNKNOWN
type Cell = -1 | 0 | 1;

export interface Step {
  readonly rule: number; // Rule id
  readonly tier: number;
  readonly constraint: number; // constraint index; -1 for R4 (hypothesis)
  readonly thread: number; // concluded thread
  readonly value: 0 | 1; // concluded value
}

export interface SolveResult {
  readonly solved: boolean;
  readonly trace: readonly Step[];
  readonly widths: readonly number[]; // available applications at each step (for minWidth)
  readonly certificate: string; // SHA-256 hex of the canonical trace
  readonly value: Int8Array; // final assignment (-1 where still unknown)
  readonly contradiction: number | null; // violated constraint index, or null
  readonly needsDeeper: boolean; // stuck below ceiling but no contradiction (would need R5)
}

export interface SolveOptions {
  /** Highest rule tier the solver may use: 1, 2/3 (counting), or 4 (hypothetical). */
  tierCeiling: 1 | 2 | 3 | 4;
  /** Initial commitments (e.g. player assertions); UNKNOWN (-1) where unset. */
  initial?: Int8Array | null;
}

interface Forcing {
  rule: number;
  constraint: number;
  thread: number;
  value: 0 | 1;
}

// ── per-constraint forcing (Tier 1 & 2) ──────────────────────────────────────

function forcedBy(c: Constraint, ci: number, s: Int8Array, out: Forcing[]): void {
  const t = c.threads;
  if (isCountType(c.type)) {
    forcedByCount(c, ci, s, out);
    return;
  }
  const a = t[0]!;
  const b = t[1]!;
  const va = s[a]! as Cell;
  const vb = s[b]! as Cell;
  switch (c.type) {
    case CType.ANCHOR: {
      // Tier 0 is handled separately in enumerate(); nothing here.
      return;
    }
    case CType.IMPL: // a → b
      if (va === 1 && vb === U) out.push({ rule: Rule.R1_1, constraint: ci, thread: b, value: 1 });
      else if (vb === 0 && va === U) out.push({ rule: Rule.R1_2, constraint: ci, thread: a, value: 0 });
      return;
    case CType.XOR: // exactly one true → b = ¬a
      if (va !== U && vb === U) out.push({ rule: Rule.R1_3, constraint: ci, thread: b, value: (1 - va) as 0 | 1 });
      else if (vb !== U && va === U) out.push({ rule: Rule.R1_3, constraint: ci, thread: a, value: (1 - vb) as 0 | 1 });
      return;
    case CType.NAND: // not both true
      if (va === 1 && vb === U) out.push({ rule: Rule.R1_4, constraint: ci, thread: b, value: 0 });
      else if (vb === 1 && va === U) out.push({ rule: Rule.R1_4, constraint: ci, thread: a, value: 0 });
      return;
    case CType.OR: // at least one true
      if (va === 0 && vb === U) out.push({ rule: Rule.R1_5, constraint: ci, thread: b, value: 1 });
      else if (vb === 0 && va === U) out.push({ rule: Rule.R1_5, constraint: ci, thread: a, value: 1 });
      return;
    case CType.EQUIV: // same value
      if (va !== U && vb === U) out.push({ rule: Rule.R1_6, constraint: ci, thread: b, value: va as 0 | 1 });
      else if (vb !== U && va === U) out.push({ rule: Rule.R1_6, constraint: ci, thread: a, value: vb as 0 | 1 });
      return;
  }
}

function forcedByCount(c: Constraint, ci: number, s: Int8Array, out: Forcing[]): void {
  const S = c.threads;
  const k = c.k ?? 0;
  let nT = 0;
  let nU = 0;
  for (const t of S) {
    const v = s[t]!;
    if (v === 1) nT++;
    else if (v === U) nU++;
  }
  const n = S.length;
  const nF = n - nT - nU;
  if (nU === 0) return; // nothing to force

  const forceAll = (value: 0 | 1, rule: number): void => {
    for (const t of S) if (s[t]! === U) out.push({ rule, constraint: ci, thread: t, value });
  };

  switch (c.type) {
    case CType.COUNT_EQ:
      if (nT === k) forceAll(0, Rule.R2_1); // quota of trues met → rest false
      else if (nF === n - k) forceAll(1, Rule.R2_1); // quota of falses met → rest true
      return;
    case CType.COUNT_LE:
      if (nT === k) forceAll(0, Rule.R2_2); // at cap → rest false
      return;
    case CType.COUNT_GE:
      if (nT + nU === k) forceAll(1, Rule.R2_2); // only just enough → rest true
      return;
  }
}

/** Enumerate all forcing applications at a given tier, sorted by (constraint, thread). */
function enumerate(constraints: readonly Constraint[], s: Int8Array, tier: number): Forcing[] {
  const out: Forcing[] = [];
  if (tier === 0) {
    for (let ci = 0; ci < constraints.length; ci++) {
      const c = constraints[ci]!;
      if (c.type === CType.ANCHOR) {
        const t = c.threads[0]!;
        if (s[t]! === U) out.push({ rule: Rule.R0, constraint: ci, thread: t, value: (c.k ?? 0) as 0 | 1 });
      }
    }
  } else if (tier === 1) {
    for (let ci = 0; ci < constraints.length; ci++) {
      const c = constraints[ci]!;
      if (!isCountType(c.type) && c.type !== CType.ANCHOR) forcedBy(c, ci, s, out);
    }
  } else if (tier === 2) {
    for (let ci = 0; ci < constraints.length; ci++) {
      const c = constraints[ci]!;
      if (isCountType(c.type)) forcedBy(c, ci, s, out);
    }
  }
  out.sort((x, y) => x.constraint - y.constraint || x.thread - y.thread);
  return out;
}

// ── consistency (contradiction detection) ────────────────────────────────────

/** True if `c` cannot be satisfied by any completion of the UNKNOWNs in `s`. */
function isViolated(c: Constraint, s: Int8Array): boolean {
  const t = c.threads;
  if (isCountType(c.type)) {
    const k = c.k ?? 0;
    let nT = 0;
    let nU = 0;
    for (const th of t) {
      const v = s[th]!;
      if (v === 1) nT++;
      else if (v === U) nU++;
    }
    const n = t.length;
    const nF = n - nT - nU;
    if (c.type === CType.COUNT_EQ) return nT > k || nF > n - k;
    if (c.type === CType.COUNT_LE) return nT > k;
    return nT + nU < k; // COUNT_GE
  }
  const va = s[t[0]!]!;
  const vb = t.length > 1 ? s[t[1]!]! : U;
  switch (c.type) {
    case CType.ANCHOR:
      return va !== U && va !== (c.k ?? 0);
    case CType.IMPL:
      return va === 1 && vb === 0;
    case CType.XOR:
      return va !== U && vb !== U && va === vb;
    case CType.NAND:
      return va === 1 && vb === 1;
    case CType.OR:
      return va === 0 && vb === 0;
    case CType.EQUIV:
      return va !== U && vb !== U && va !== vb;
  }
  return false;
}

function firstViolated(constraints: readonly Constraint[], s: Int8Array): number {
  for (let ci = 0; ci < constraints.length; ci++) if (isViolated(constraints[ci]!, s)) return ci;
  return -1;
}

/** Propagate tiers 0..2 forcing to fixpoint (no trace). Used inside hypotheticals. */
function propagate(constraints: readonly Constraint[], s: Int8Array): void {
  for (;;) {
    let progressed = false;
    for (let tier = 0; tier <= 2; tier++) {
      const apps = enumerate(constraints, s, tier);
      if (apps.length > 0) {
        for (const f of apps) if (s[f.thread]! === U) s[f.thread] = f.value;
        progressed = true;
        break;
      }
    }
    if (!progressed) return;
  }
}

// ── R4.1 hypothetical ────────────────────────────────────────────────────────

interface Hypo {
  thread: number;
  value: 0 | 1; // the forced conclusion (= ¬assumption)
  width: number; // count of decisive (thread,value) tests available
}

/**
 * Scan threads ascending, value order [TRUE, FALSE]. Assume (t,v), propagate
 * tiers ≤2 to fixpoint; if that contradicts, (t) is forced to ¬v. The first
 * such decisive test in scan order is canonical. `width` counts all decisive
 * tests available (branching factor at the hypothetical stage).
 */
function findHypothetical(constraints: readonly Constraint[], s: Int8Array): Hypo | null {
  let first: Hypo | null = null;
  let width = 0;
  for (let t = 0; t < s.length; t++) {
    if (s[t]! !== U) continue;
    for (const v of [1, 0] as const) {
      const clone = s.slice();
      clone[t] = v;
      propagate(constraints, clone);
      if (firstViolated(constraints, clone) !== -1) {
        width++;
        if (first === null) first = { thread: t, value: (1 - v) as 0 | 1, width: 0 };
      }
    }
  }
  if (first === null) return null;
  return { ...first, width };
}

// ── main solve loop ──────────────────────────────────────────────────────────

function certify(trace: readonly Step[]): string {
  // Serialize the LOGICAL content only (rule, constraint, thread, value); width
  // and other derived metrics are excluded so the certificate is stable.
  const bytes = new Uint8Array(trace.length * 4);
  let i = 0;
  for (const st of trace) {
    bytes[i++] = st.rule & 0xff;
    bytes[i++] = (st.constraint + 1) & 0xff; // -1 → 0
    bytes[i++] = st.thread & 0xff;
    bytes[i++] = st.value & 0xff;
  }
  return sha256Hex(bytes);
}

export function solve(threadCount: number, constraints: readonly Constraint[], opts: SolveOptions): SolveResult {
  const s = new Int8Array(threadCount).fill(U);
  if (opts.initial) s.set(opts.initial.subarray(0, threadCount));
  const ceiling = opts.tierCeiling;
  const countEnabled = ceiling >= 2;
  const hypoEnabled = ceiling >= 4;

  const trace: Step[] = [];
  const widths: number[] = [];

  for (;;) {
    // Tier-ordered greedy: lowest non-empty tier wins.
    let applied: Forcing | null = null;
    let width = 0;
    for (let tier = 0; tier <= 2; tier++) {
      if (tier === 2 && !countEnabled) break;
      const apps = enumerate(constraints, s, tier);
      if (apps.length > 0) {
        applied = apps[0]!;
        width = apps.length;
        break;
      }
    }

    if (applied) {
      s[applied.thread] = applied.value;
      trace.push({
        rule: applied.rule,
        tier: tierOf(applied.rule),
        constraint: applied.constraint,
        thread: applied.thread,
        value: applied.value,
      });
      widths.push(width);
      continue;
    }

    // Tiers ≤2 exhausted. Check for a contradiction under current commitments.
    const bad = firstViolated(constraints, s);
    if (bad !== -1) {
      return { solved: false, trace, widths, certificate: certify(trace), value: s, contradiction: bad, needsDeeper: false };
    }

    // Solved?
    if (allKnown(s)) {
      return { solved: true, trace, widths, certificate: certify(trace), value: s, contradiction: null, needsDeeper: false };
    }

    // Try a hypothetical (R4.1) if the ceiling allows.
    if (hypoEnabled) {
      const hyp = findHypothetical(constraints, s);
      if (hyp) {
        s[hyp.thread] = hyp.value;
        trace.push({ rule: Rule.R4_1, tier: 4, constraint: -1, thread: hyp.thread, value: hyp.value });
        widths.push(hyp.width);
        continue;
      }
    }

    // Stuck below ceiling with no contradiction: would require deeper reasoning (R5).
    return { solved: false, trace, widths, certificate: certify(trace), value: s, contradiction: null, needsDeeper: true };
  }
}

function allKnown(s: Int8Array): boolean {
  for (let i = 0; i < s.length; i++) if (s[i]! === U) return false;
  return true;
}
