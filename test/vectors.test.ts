// The cross-implementation lock (TESTING §1). These vectors are canonical and
// append-only; any change to the wire format, solver trace order, or grading
// that shifts an existing vector breaks this test on purpose. A future Rust or
// Swift port must reproduce every entry byte-for-byte.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePuzzle, decodeResult, encodePuzzle, peekKind, puzzleDigestHex, PuzzleRef } from "../src/core/index.js";
import { grade } from "../src/gen/index.js";
import { solve } from "../src/solver/index.js";

const DIR = join(process.cwd(), "test", "vectors");
const load = (p: string): any[] => JSON.parse(readFileSync(join(DIR, p), "utf8"));

describe("wire vectors", () => {
  const wire = load("wire/wire.json");

  it("has ≥40 entries (TESTING §1)", () => {
    expect(wire.length).toBeGreaterThanOrEqual(40);
  });

  for (const v of wire) {
    if (v.reject) {
      it(`${v.name} rejects loudly (${v.expect})`, () => {
        expect(() => (peekKind(v.payload) === 1 ? decodeResult(v.payload) : decodePuzzle(v.payload))).toThrow(
          new RegExp(v.expect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        );
      });
    } else if (v.kind === "puzzle") {
      it(`${v.name} decodes to the canonical object and re-encodes identically`, () => {
        const d = decodePuzzle(v.payload);
        expect(d.threadCount).toBe(v.decoded.threadCount);
        expect(d.layoutSeed).toBe(v.decoded.layoutSeed);
        expect(d.constraints).toEqual(v.decoded.constraints);
        expect(d.solution === undefined ? undefined : d.solution.toString()).toEqual(v.decoded.solution);
        // Byte-identity round-trip.
        expect(encodePuzzle(d, { includeSolution: d.solution !== undefined })).toBe(v.payload);
      });
    } else {
      it(`${v.name} (result) decodes to the canonical object`, () => {
        const d = decodeResult(v.payload);
        expect(d.solved).toBe(v.decoded.solved);
        expect(d.durationSec).toBe(v.decoded.durationSec);
        if (d.ref.kind === PuzzleRef.DAILY) expect(d.ref.dateCode).toBe(v.decoded.ref.dateCode);
        else expect([...d.ref.digest]).toEqual(v.decoded.ref.digest);
      });
    }
  }
});

describe("solve vectors — traces reproduce exactly", () => {
  const solveV = load("solve/solve.json");
  it("has ≥30 entries (TESTING §1)", () => {
    expect(solveV.length).toBeGreaterThanOrEqual(30);
  });
  for (const v of solveV) {
    it(`${v.name} reproduces its certificate and step sequence`, () => {
      const p = decodePuzzle(v.payload);
      const r = solve(p.threadCount, p.constraints, { tierCeiling: 4 });
      expect(r.solved).toBe(true);
      expect(r.certificate).toBe(v.certificate);
      expect(r.trace.map((s) => [s.rule, s.constraint, s.thread, s.value])).toEqual(
        v.trace.map((s: any) => [s.rule, s.constraint, s.thread, s.value]),
      );
    });
  }
});

describe("digest vectors — canonical digest reproduces (§6)", () => {
  const digestV = load("digest/digest.json");
  const solveV: any[] = load("solve/solve.json");
  const byName = new Map(solveV.map((s) => [s.name, s]));
  for (const v of digestV) {
    const sol = byName.get(v.name);
    if (!sol) continue; // orientation vectors have no payload; checked below
    it(`${v.name} recomputes its canonical digest`, () => {
      const p = decodePuzzle(sol.payload);
      expect(puzzleDigestHex(p.threadCount, p.constraints)).toBe(v.digest);
    });
  }
  it("digest is authoring-order independent (orient-a === orient-b)", () => {
    const a = digestV.find((v: any) => v.name === "digest-orient-a");
    const b = digestV.find((v: any) => v.name === "digest-orient-b");
    expect(a && b).toBeTruthy();
    expect(a.digest).toBe(b.digest);
  });
});

describe("grade vectors — DifficultyVectors reproduce", () => {
  const gradeV = load("grade/grade.json");
  const solveV: any[] = load("solve/solve.json");
  const byName = new Map(solveV.map((s) => [s.name, s]));
  for (const v of gradeV) {
    it(`${v.name} regrades identically`, () => {
      const sol = byName.get(v.name)!;
      const p = decodePuzzle(sol.payload);
      const r = solve(p.threadCount, p.constraints, { tierCeiling: 4 });
      const d = grade(r, p.constraints, p.threadCount);
      expect(d).toEqual(v.difficulty);
    });
  }
});
