// `fumbo vectors --emit` — the cross-implementation lock (TESTING §1). Generates
// canonical, DETERMINISTIC vector sets and writes them with an append-only
// guard: it refuses to modify an existing entry (that would break decode-forever
// / trace-forever guarantees). New entries append; changed entries hard-error.
//
// Same discipline as Muhuri's cross-language vectors: any future Rust/Swift port
// must reproduce these byte-for-byte before merging.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CType,
  base64urlDecode,
  base64urlEncode,
  crc32,
  decodePuzzle,
  encodePuzzle,
  encodeResult,
  puzzleDigestHex,
  PuzzleRef,
  WIRE_PREFIX,
  type Constraint,
  type WirePuzzle,
} from "../src/core/index.js";
import { solve } from "../src/solver/index.js";
import { generate, grade, LADDER, type TargetTier } from "../src/gen/index.js";

const VECTORS_DIR = join(process.cwd(), "test", "vectors");

interface WireGood {
  name: string;
  kind: "puzzle" | "result";
  payload: string;
  decoded: unknown;
}
interface WireReject {
  name: string;
  payload: string;
  reject: true;
  expect: string;
}
type WireVector = WireGood | WireReject;

interface SolveVector {
  name: string;
  payload: string; // shared puzzle form (no solution)
  threadCount: number;
  certificate: string;
  trace: { rule: number; tier: number; constraint: number; thread: number; value: number }[];
}

interface GradeVector {
  name: string;
  difficulty: unknown;
}

interface DigestVector {
  name: string;
  threadCount: number;
  digest: string; // canonical SHA-256 hex (SPEC-CORE §6) — the sigil seed
}

function decodedPuzzleJson(p: WirePuzzle): unknown {
  return {
    threadCount: p.threadCount,
    layoutSeed: p.layoutSeed,
    constraints: p.constraints,
    ...(p.solution !== undefined ? { solution: p.solution.toString() } : {}),
  };
}

function buildWirePuzzle(threadCount: number, constraints: Constraint[], layoutSeed: number): WirePuzzle {
  const r = solve(threadCount, constraints, { tierCeiling: 4 });
  const solution = r.solved
    ? (() => {
        let m = 0n;
        for (let i = 0; i < threadCount; i++) if (r.value[i] === 1) m |= 1n << BigInt(i);
        return m;
      })()
    : 0n;
  return { threadCount, layoutSeed, constraints, solution };
}

function generateVectors(): { wire: WireVector[]; solve: SolveVector[]; grade: GradeVector[]; digest: DigestVector[] } {
  const wire: WireVector[] = [];
  const solveV: SolveVector[] = [];
  const gradeV: GradeVector[] = [];
  const digestV: DigestVector[] = [];

  // 1. One minimal puzzle per binary constraint type (shared + local forms).
  const binary: [string, CType][] = [
    ["impl", CType.IMPL],
    ["xor", CType.XOR],
    ["nand", CType.NAND],
    ["or", CType.OR],
    ["equiv", CType.EQUIV],
  ];
  for (const [name, type] of binary) {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type, threads: [0, 1] },
    ];
    const wp = buildWirePuzzle(2, cs, 0x1000 + type);
    const local = encodePuzzle(wp, { includeSolution: true });
    const shared = encodePuzzle(wp);
    wire.push({ name: `puzzle-${name}-local`, kind: "puzzle", payload: local, decoded: decodedPuzzleJson(decodePuzzle(local)) });
    wire.push({ name: `puzzle-${name}-shared`, kind: "puzzle", payload: shared, decoded: decodedPuzzleJson(decodePuzzle(shared)) });
  }

  // 2. COUNT_* at min arity (2 → k=1) and max arity (6 → k=3).
  const counts: [string, CType][] = [
    ["count_eq", CType.COUNT_EQ],
    ["count_le", CType.COUNT_LE],
    ["count_ge", CType.COUNT_GE],
  ];
  for (const [name, type] of counts) {
    for (const arity of [2, 6]) {
      const threads = [...Array(arity).keys()];
      const cs: Constraint[] = [
        { type: CType.ANCHOR, threads: [0], k: 1 },
        { type, threads, k: Math.min(arity - 1, Math.max(1, Math.floor(arity / 2))) },
      ];
      const wp = buildWirePuzzle(arity, cs, 0x2000 + type * 10 + arity);
      const local = encodePuzzle(wp, { includeSolution: true });
      wire.push({ name: `puzzle-${name}-a${arity}-local`, kind: "puzzle", payload: local, decoded: decodedPuzzleJson(decodePuzzle(local)) });
    }
  }

  // 2b. COUNT_EQ_WIDE (appended id 9) at arity 8 — the wide-count type used by
  // grid skins wider than 6. Anchors 0..3 true so the puzzle is fully solvable.
  {
    const threads = [0, 1, 2, 3, 4, 5, 6, 7];
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type: CType.ANCHOR, threads: [1], k: 1 },
      { type: CType.ANCHOR, threads: [2], k: 1 },
      { type: CType.ANCHOR, threads: [3], k: 1 },
      { type: CType.COUNT_EQ_WIDE, threads, k: 4 },
    ];
    const wp = buildWirePuzzle(8, cs, 0x2f00);
    const local = encodePuzzle(wp, { includeSolution: true });
    wire.push({ name: "puzzle-count_eq_wide-a8-local", kind: "puzzle", payload: local, decoded: decodedPuzzleJson(decodePuzzle(local)) });
  }

  // 3. Result vectors: both puzzleRef kinds.
  const rDaily = encodeResult({ ref: { kind: PuzzleRef.DAILY, dateCode: 258 }, solved: true, durationSec: 252, hintsUsed: 0, testsUsed: 1, maxTierExercised: 3 });
  wire.push({ name: "result-daily", kind: "result", payload: rDaily, decoded: { ref: { kind: PuzzleRef.DAILY, dateCode: 258 }, solved: true, durationSec: 252, hintsUsed: 0, testsUsed: 1, maxTierExercised: 3 } });
  const digest = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const rInline = encodeResult({ ref: { kind: PuzzleRef.INLINE_DIGEST, digest }, solved: false, durationSec: 65535, hintsUsed: 2, testsUsed: 3, maxTierExercised: 2 });
  wire.push({ name: "result-inline", kind: "result", payload: rInline, decoded: { ref: { kind: PuzzleRef.INLINE_DIGEST, digest: [...digest] }, solved: false, durationSec: 65535, hintsUsed: 2, testsUsed: 3, maxTierExercised: 2 } });

  // 4. Reject vectors (must fail loudly, never partially apply).
  const good = encodePuzzle(buildWirePuzzle(2, [{ type: CType.ANCHOR, threads: [0], k: 1 }, { type: CType.XOR, threads: [0, 1] }], 7));
  const goodBytes = base64urlDecode(good.slice(WIRE_PREFIX.length));
  const corrupt = goodBytes.slice();
  corrupt[3] = (corrupt[3]! ^ 0xff) & 0xff;
  wire.push({ name: "reject-crc", payload: WIRE_PREFIX + base64urlEncode(corrupt), reject: true, expect: "crc mismatch" });
  wire.push({ name: "reject-truncated", payload: WIRE_PREFIX + base64urlEncode(goodBytes.subarray(0, 3)), reject: true, expect: "truncated" });
  wire.push({ name: "reject-future-prefix", payload: "fmb9_AAAAAAAA", reject: true, expect: "newer version" });
  {
    const body = [0x00, 1, 1, 0, 0, 0, 0, 0, 99, 1, 0];
    const c = crc32(Uint8Array.from(body));
    const withCrc = Uint8Array.from([...body, c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, (c >>> 24) & 0xff]);
    wire.push({ name: "reject-unknown-type", payload: WIRE_PREFIX + base64urlEncode(withCrc), reject: true, expect: "newer version" });
  }

  // 5. Generated puzzles across the ladder → wire (shared) + solve + grade vectors.
  for (const tier of [1, 2, 3, 4] as TargetTier[]) {
    let made = 0;
    for (let seed = 0; made < 8 && seed < 400; seed++) {
      const r = generate(LADDER[tier], seed * 977 + tier * 17);
      if (!r.ok) continue;
      made++;
      const name = `gen-t${tier}-${made}`;
      const wp: WirePuzzle = { threadCount: r.puzzle.threads.length, layoutSeed: r.puzzle.layoutSeed, constraints: [...r.puzzle.constraints] };
      const shared = encodePuzzle(wp);
      wire.push({ name: `puzzle-${name}`, kind: "puzzle", payload: shared, decoded: decodedPuzzleJson(decodePuzzle(shared)) });
      const sr = solve(wp.threadCount, wp.constraints, { tierCeiling: 4 });
      solveV.push({ name, payload: shared, threadCount: wp.threadCount, certificate: sr.certificate, trace: sr.trace.map((s) => ({ ...s })) });
      gradeV.push({ name, difficulty: grade(sr, wp.constraints, wp.threadCount) });
      // canonical digest (§6) — the sigil seed and a cross-implementation surface
      digestV.push({ name, threadCount: wp.threadCount, digest: puzzleDigestHex(wp.threadCount, wp.constraints) });
    }
  }

  // 6. Order-invariance digest vectors: the digest must be independent of
  // constraint authoring order even for orientation-tied constraints (§6).
  {
    const cs: Constraint[] = [
      { type: CType.ANCHOR, threads: [0], k: 1 },
      { type: CType.ANCHOR, threads: [1], k: 0 },
      { type: CType.IMPL, threads: [0, 1] },
      { type: CType.IMPL, threads: [1, 0] },
    ];
    digestV.push({ name: "digest-orient-a", threadCount: 2, digest: puzzleDigestHex(2, cs) });
    digestV.push({ name: "digest-orient-b", threadCount: 2, digest: puzzleDigestHex(2, [cs[0]!, cs[1]!, cs[3]!, cs[2]!]) });
  }

  return { wire, solve: solveV, grade: gradeV, digest: digestV };
}

function writeWithGuard<T extends { name: string }>(path: string, next: T[]): { added: number; kept: number } {
  mkdirSync(dirname(path), { recursive: true });
  const existing: T[] = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T[]) : [];
  const existingByName = new Map(existing.map((e) => [e.name, JSON.stringify(e)]));
  const nextByName = new Map(next.map((e) => [e.name, e]));

  for (const [name, json] of existingByName) {
    const candidate = nextByName.get(name);
    if (candidate && JSON.stringify(candidate) !== json) {
      throw new Error(`vectors are append-only: emitting would modify existing entry "${name}" in ${path}`);
    }
  }
  // Union: keep all existing (even if no longer generated), append genuinely new.
  const merged: T[] = [...existing];
  let added = 0;
  for (const e of next) {
    if (!existingByName.has(e.name)) {
      merged.push(e);
      added++;
    }
  }
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
  return { added, kept: existing.length };
}

export function emitVectors(): void {
  const { wire, solve: solveV, grade: gradeV, digest: digestV } = generateVectors();
  const w = writeWithGuard(join(VECTORS_DIR, "wire", "wire.json"), wire);
  const s = writeWithGuard(join(VECTORS_DIR, "solve", "solve.json"), solveV);
  const g = writeWithGuard(join(VECTORS_DIR, "grade", "grade.json"), gradeV);
  const d = writeWithGuard(join(VECTORS_DIR, "digest", "digest.json"), digestV);
  console.log(`digest: ${digestV.length} vectors (${d.added} new, ${d.kept} preserved)`);
  console.log(`wire:  ${wire.length} vectors (${w.added} new, ${w.kept} preserved)`);
  console.log(`solve: ${solveV.length} vectors (${s.added} new, ${s.kept} preserved)`);
  console.log(`grade: ${gradeV.length} vectors (${g.added} new, ${g.kept} preserved)`);
}
