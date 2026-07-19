import { describe, expect, it } from "vitest";
import { CType, type Constraint } from "../src/core/index.js";
import { Rule, solve } from "../src/solver/index.js";

function values(s: Int8Array): number[] {
  return [...s];
}

describe("Tier 1 — local forcing", () => {
  it("R0 + R1.1 IMPL_MP chain", () => {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type: CType.IMPL, threads: [0, 1] },
      { type: CType.IMPL, threads: [1, 2] },
    ];
    const r = solve(3, cs, { tierCeiling: 1 });
    expect(r.solved).toBe(true);
    expect(values(r.value)).toEqual([1, 1, 1]);
    expect(r.trace.map((s) => s.rule)).toEqual([Rule.R0, Rule.R1_1, Rule.R1_1]);
    expect(r.trace.every((s) => s.tier <= 1)).toBe(true);
  });

  it("R1.2 IMPL_MT (modus tollens)", () => {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [1], k: 0 },
      { type: CType.IMPL, threads: [0, 1] },
    ];
    const r = solve(2, cs, { tierCeiling: 1 });
    expect(r.solved).toBe(true);
    expect(values(r.value)).toEqual([0, 0]);
    expect(r.trace.map((s) => s.rule)).toContain(Rule.R1_2);
  });

  it("R1.3 XOR, R1.4 NAND, R1.5 OR, R1.6 EQUIV", () => {
    const xor = solve(2, [{ type: CType.ANCHOR, threads: [0], k: 1 }, { type: CType.XOR, threads: [0, 1] }], { tierCeiling: 1 });
    expect(values(xor.value)).toEqual([1, 0]);
    const nand = solve(2, [{ type: CType.ANCHOR, threads: [0], k: 1 }, { type: CType.NAND, threads: [0, 1] }], { tierCeiling: 1 });
    expect(values(nand.value)).toEqual([1, 0]);
    const or = solve(2, [{ type: CType.ANCHOR, threads: [0], k: 0 }, { type: CType.OR, threads: [0, 1] }], { tierCeiling: 1 });
    expect(values(or.value)).toEqual([0, 1]);
    const eq = solve(2, [{ type: CType.ANCHOR, threads: [0], k: 1 }, { type: CType.EQUIV, threads: [0, 1] }], { tierCeiling: 1 });
    expect(values(eq.value)).toEqual([1, 1]);
  });
});

describe("Tier 2 — counting", () => {
  it("R2.1 COUNT_EQ saturation (quota of trues met → rest false)", () => {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type: CType.ANCHOR, threads: [1], k: 1 },
      { type: CType.COUNT_EQ, threads: [0, 1, 2], k: 2 },
    ];
    const r = solve(3, cs, { tierCeiling: 2 });
    expect(r.solved).toBe(true);
    expect(values(r.value)).toEqual([1, 1, 0]);
    expect(r.trace.some((s) => s.rule === Rule.R2_1)).toBe(true);
  });

  it("R2.1 COUNT_EQ fill (quota of falses met → rest true)", () => {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 0 },
      { type: CType.COUNT_EQ, threads: [0, 1, 2], k: 2 },
    ];
    const r = solve(3, cs, { tierCeiling: 2 });
    expect(values(r.value)).toEqual([0, 1, 1]);
  });

  it("R2.2 COUNT_LE cap", () => {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type: CType.COUNT_LE, threads: [0, 1, 2], k: 1 },
    ];
    const r = solve(3, cs, { tierCeiling: 2 });
    expect(values(r.value)).toEqual([1, 0, 0]);
    expect(r.trace.some((s) => s.rule === Rule.R2_2)).toBe(true);
  });

  it("R2.2 COUNT_GE floor", () => {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 0 },
      { type: CType.COUNT_GE, threads: [0, 1, 2], k: 2 },
    ];
    const r = solve(3, cs, { tierCeiling: 2 });
    expect(values(r.value)).toEqual([0, 1, 1]);
  });

  it("R2.1 COUNT_EQ_WIDE (id 9) forces like COUNT_EQ at arity 8", () => {
    // 8 threads; anchor 3 true; exactly-4 over all 8 ⇒ once 4 trues known the
    // rest are false, and the remaining falses fill once the quota is met.
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type: CType.ANCHOR, threads: [1], k: 1 },
      { type: CType.ANCHOR, threads: [2], k: 1 },
      { type: CType.ANCHOR, threads: [3], k: 1 },
      { type: CType.COUNT_EQ_WIDE, threads: [0, 1, 2, 3, 4, 5, 6, 7], k: 4 },
    ];
    const r = solve(8, cs, { tierCeiling: 2 });
    expect(r.solved).toBe(true);
    expect(values(r.value)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(r.trace.some((s) => s.rule === Rule.R2_1)).toBe(true);
  });

  it("counting is unavailable below the ceiling", () => {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type: CType.ANCHOR, threads: [1], k: 1 },
      { type: CType.COUNT_EQ, threads: [0, 1, 2], k: 2 },
    ];
    const r = solve(3, cs, { tierCeiling: 1 });
    expect(r.solved).toBe(false); // thread 2 never forced without R2
  });
});

describe("Tier 4 — hypothetical (TEST)", () => {
  // OR ∧ NAND ∧ IMPL over {0,1} forces 0=F,1=T but only via a hypothesis:
  // no tier≤2 rule fires until you assume 0=T and hit the NAND contradiction.
  const cs: Constraint[] = [
    { type: CType.OR, threads: [0, 1] },
    { type: CType.NAND, threads: [0, 1] },
    { type: CType.IMPL, threads: [0, 1] },
  ];

  it("solves with R4.1 then cascades", () => {
    const r = solve(2, cs, { tierCeiling: 4 });
    expect(r.solved).toBe(true);
    expect(values(r.value)).toEqual([0, 1]);
    expect(r.trace[0]!.rule).toBe(Rule.R4_1);
    expect(r.trace[0]!.thread).toBe(0);
    expect(r.trace[0]!.value).toBe(0); // assumed 0=T, contradicted → 0=F
    expect(r.trace.filter((s) => s.rule === Rule.R4_1).length).toBe(1);
    expect(r.widths[0]).toBe(2); // two decisive tests available: (0,T) and (1,F)
  });

  it("is rejected below the hypothetical ceiling (R5-gating path)", () => {
    const r = solve(2, cs, { tierCeiling: 3 });
    expect(r.solved).toBe(false);
    expect(r.needsDeeper).toBe(true); // stuck, no contradiction → would need deeper reasoning
    expect(r.contradiction).toBeNull();
  });
});

describe("contradiction detection", () => {
  it("conflicting anchors surface as a contradiction, not a solve", () => {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type: CType.ANCHOR, threads: [0], k: 0 },
    ];
    const r = solve(1, cs, { tierCeiling: 2 });
    expect(r.solved).toBe(false);
    expect(r.contradiction).toBe(1);
  });
});

describe("determinism (certificate stability)", () => {
  it("same input → same trace and certificate", () => {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type: CType.IMPL, threads: [0, 1] },
      { type: CType.XOR, threads: [1, 2] },
    ];
    const a = solve(3, cs, { tierCeiling: 2 });
    const b = solve(3, cs, { tierCeiling: 2 });
    expect(a.certificate).toBe(b.certificate);
    expect(a.certificate).toMatch(/^[0-9a-f]{64}$/);
    expect(a.trace).toEqual(b.trace);
  });
});
