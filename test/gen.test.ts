import { describe, expect, it } from "vitest";
import { CType, type Constraint } from "../src/core/index.js";
import { countModels, generate, generateOne, isUnique, LADDER, verifyPuzzle } from "../src/gen/index.js";
import { solve } from "../src/solver/index.js";

// Union-find connectivity over non-ANCHOR constraints (well-formedness §CORE 1.3).
function isConnected(n: number, constraints: readonly Constraint[]): boolean {
  const parent = [...Array(n).keys()];
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (const c of constraints) {
    if (c.type === CType.ANCHOR) continue;
    for (let i = 1; i < c.threads.length; i++) union(c.threads[0]!, c.threads[i]!);
  }
  const root = find(0);
  for (let i = 1; i < n; i++) if (find(i) !== root) return false;
  return true;
}

describe("model counting", () => {
  it("a lone XOR over 2 threads has exactly 2 models (early exit caps at 2)", () => {
    expect(countModels(2, [{ type: CType.XOR, threads: [0, 1] }], 2)).toBe(2);
  });
  it("anchored XOR is unique", () => {
    expect(isUnique(2, [{ type: CType.ANCHOR, threads: [0], k: 1 }, { type: CType.XOR, threads: [0, 1] }])).toBe(true);
  });
  it("an unconstrained thread multiplies models (≥2)", () => {
    expect(countModels(3, [{ type: CType.ANCHOR, threads: [0], k: 1 }], 2)).toBe(2);
  });
});

describe("generateOne determinism", () => {
  it("same seed + request → byte-identical puzzle", () => {
    const a = generateOne(0x1234, LADDER[2]);
    const b = generateOne(0x1234, LADDER[2]);
    expect(a.ok).toBe(b.ok);
    if (a.ok && b.ok) {
      expect(a.puzzle.constraints).toEqual(b.puzzle.constraints);
      expect(a.puzzle.solution).toBe(b.puzzle.solution);
      expect(a.puzzle.difficulty).toEqual(b.puzzle.difficulty);
      expect(a.certificate).toBe(b.certificate);
    }
  });
});

describe("emitted puzzles satisfy every invariant", () => {
  for (const tier of [1, 2, 3, 4] as const) {
    it(`T${tier}: unique, deducible at tier, connected, correct band, verifies`, () => {
      const r = generate(LADDER[tier], 100 + tier);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const p = r.puzzle;
      const n = p.threads.length;

      // Unique.
      expect(isUnique(n, p.constraints)).toBe(true);
      // Connected.
      expect(isConnected(n, p.constraints)).toBe(true);
      // ≥1 anchor; every thread in ≥1 non-anchor constraint.
      expect(p.constraints.some((c) => c.type === CType.ANCHOR)).toBe(true);
      const inNonAnchor = new Set<number>();
      for (const c of p.constraints) if (c.type !== CType.ANCHOR) for (const t of c.threads) inNonAnchor.add(t);
      expect(inNonAnchor.size).toBe(n);
      // Deducible at target tier; certificate matches.
      const s = solve(n, p.constraints, { tierCeiling: tier });
      expect(s.solved).toBe(true);
      expect(s.certificate).toBe(r.certificate);
      // Solution equals the model.
      for (let i = 0; i < n; i++) expect(s.value[i]).toBe(Number((p.solution >> BigInt(i)) & 1n));
      // Correct band; T4 genuinely needs a hypothetical, T≤3 never do.
      const band = p.difficulty.scalar < 3 ? 1 : p.difficulty.scalar < 6 ? 2 : p.difficulty.scalar < 10 ? 3 : 4;
      expect(band).toBe(tier);
      if (tier === 4) expect(p.difficulty.hypoCount).toBeGreaterThanOrEqual(1);
      else expect(p.difficulty.hypoCount).toBe(0);
      // Independent verification pass.
      expect(verifyPuzzle(p, r.certificate, tier)).toBe(true);
    });
  }
});

describe("property fuzz: 40 seeds per tier all well-formed", () => {
  it("no emitted puzzle violates uniqueness/deducibility/connectivity", () => {
    for (const tier of [1, 2, 3, 4] as const) {
      let checked = 0;
      for (let seed = 0; seed < 40; seed++) {
        const r = generate(LADDER[tier], seed * 131 + tier);
        if (!r.ok) continue;
        checked++;
        const n = r.puzzle.threads.length;
        expect(isUnique(n, r.puzzle.constraints)).toBe(true);
        expect(isConnected(n, r.puzzle.constraints)).toBe(true);
        expect(solve(n, r.puzzle.constraints, { tierCeiling: tier }).solved).toBe(true);
      }
      expect(checked).toBeGreaterThan(0);
    }
  });
});
