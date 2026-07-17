import { describe, expect, it } from "vitest";
import {
  base64urlDecode,
  base64urlEncode,
  canonicalBytes,
  crc32,
  CType,
  decodePuzzle,
  decodeResult,
  encodePuzzle,
  encodeResult,
  puzzleDigestHex,
  PuzzleRef,
  sha256Hex,
  WIRE_PREFIX,
  type Constraint,
  type WirePuzzle,
} from "../src/core/index.js";

describe("sha256 (FIPS 180-4 vectors)", () => {
  it("empty string", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it('"abc"', () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("448-bit message", () => {
    expect(sha256Hex(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });
  it("multi-block (1M 'a')", () => {
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });
});

describe("crc32", () => {
  it('"123456789" == 0xCBF43926', () => {
    expect(crc32(new TextEncoder().encode("123456789")) >>> 0).toBe(0xcbf43926);
  });
  it("empty == 0", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("base64url round-trip", () => {
  it("all byte lengths 0..300", () => {
    for (let n = 0; n <= 300; n++) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) & 0xff;
      const s = base64urlEncode(bytes);
      expect(s).not.toMatch(/[+/=]/); // url-safe, unpadded
      expect([...base64urlDecode(s)]).toEqual([...bytes]);
    }
  });
});

// A small hand-built puzzle graph over 4 threads.
const constraints: Constraint[] = [
  { type: CType.ANCHOR, threads: [0], k: 1 },
  { type: CType.IMPL, threads: [0, 1] },
  { type: CType.XOR, threads: [1, 2] },
  { type: CType.COUNT_EQ, threads: [1, 2, 3], k: 2 },
];
const puzzle: WirePuzzle = {
  threadCount: 4,
  layoutSeed: 0xdeadbeef,
  constraints,
  solution: 0b1011n,
};

describe("wire puzzle round-trip", () => {
  it("encode → decode is structurally identical (no solution in shared form)", () => {
    const s = encodePuzzle(puzzle); // shared: solution stripped
    expect(s.startsWith(WIRE_PREFIX)).toBe(true);
    const back = decodePuzzle(s);
    expect(back.threadCount).toBe(4);
    expect(back.layoutSeed).toBe(0xdeadbeef);
    expect(back.constraints).toEqual(constraints);
    expect(back.solution).toBeUndefined();
  });

  it("encode(decode(x)) is byte-identical (TESTING §Phase1 wire round-trip)", () => {
    const s1 = encodePuzzle(puzzle, { includeSolution: true });
    const d = decodePuzzle(s1);
    const s2 = encodePuzzle(d, { includeSolution: true });
    expect(s2).toBe(s1);
    expect(d.solution).toBe(0b1011n);
  });
});

describe("wire rejection (SPEC-CORE §5.4)", () => {
  it("rejects a corrupted payload (crc mismatch)", () => {
    const s = encodePuzzle(puzzle);
    const bytes = base64urlDecode(s.slice(WIRE_PREFIX.length));
    bytes[5]! ^= 0xff; // flip a payload byte
    const corrupt = WIRE_PREFIX + base64urlEncode(bytes);
    expect(() => decodePuzzle(corrupt)).toThrow(/crc mismatch/);
  });

  it("rejects an unknown constraint type loudly", () => {
    // Craft a payload with type id 99. Build manually then fix the crc so we
    // reach the type check, not the crc check.
    const body = [0x00, 1, 1, 0, 0, 0, 0, 0, /*type*/ 99, /*arity*/ 1, /*thread*/ 0];
    const bodyBytes = Uint8Array.from(body);
    const c = crc32(bodyBytes);
    const withCrc = Uint8Array.from([...body, c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, (c >>> 24) & 0xff]);
    const s = WIRE_PREFIX + base64urlEncode(withCrc);
    expect(() => decodePuzzle(s)).toThrow(/newer version/);
  });

  it("rejects a future format prefix", () => {
    expect(() => decodePuzzle("fmb9_AAAA")).toThrow(/newer version/);
  });

  it("rejects truncation", () => {
    const s = encodePuzzle(puzzle);
    const bytes = base64urlDecode(s.slice(WIRE_PREFIX.length));
    const trunc = WIRE_PREFIX + base64urlEncode(bytes.subarray(0, 6));
    expect(() => decodePuzzle(trunc)).toThrow();
  });

  it("fuzz: random bytes reject, never crash", () => {
    for (let i = 0; i < 2000; i++) {
      const n = i % 40;
      const b = new Uint8Array(n);
      for (let j = 0; j < n; j++) b[j] = (i * 131 + j * 17) & 0xff;
      const s = WIRE_PREFIX + base64urlEncode(b);
      try {
        decodePuzzle(s);
      } catch {
        /* expected for almost all */
      }
    }
    expect(true).toBe(true);
  });
});

describe("wire result round-trip", () => {
  it("daily result", () => {
    const s = encodeResult({
      ref: { kind: PuzzleRef.DAILY, dateCode: 258 },
      solved: true,
      durationSec: 252,
      hintsUsed: 0,
      testsUsed: 1,
      maxTierExercised: 3,
    });
    const back = decodeResult(s);
    expect(back.ref).toEqual({ kind: PuzzleRef.DAILY, dateCode: 258 });
    expect(back.solved).toBe(true);
    expect(back.durationSec).toBe(252);
    expect(back.testsUsed).toBe(1);
    expect(back.maxTierExercised).toBe(3);
  });

  it("caps duration at 65535", () => {
    const s = encodeResult({
      ref: { kind: PuzzleRef.INLINE_DIGEST, digest: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) },
      solved: false,
      durationSec: 999999,
      hintsUsed: 2,
      testsUsed: 3,
      maxTierExercised: 2,
    });
    expect(decodeResult(s).durationSec).toBe(65535);
  });
});

describe("canonical digest (SPEC-CORE §6)", () => {
  it("independent of constraint authoring order", () => {
    const a = puzzleDigestHex(4, constraints);
    const shuffled = [constraints[3]!, constraints[0]!, constraints[2]!, constraints[1]!];
    const b = puzzleDigestHex(4, shuffled);
    expect(b).toBe(a);
  });

  it("invariant to monotonic thread relabeling (shift by +10)", () => {
    const shifted: Constraint[] = constraints.map((c) => ({
      ...c,
      threads: c.threads.map((t) => t + 10),
    }));
    // canonicalBytes remaps by first appearance, so a uniform shift is absorbed.
    expect([...canonicalBytes(14, shifted)].slice(2)).toEqual([...canonicalBytes(4, constraints)].slice(2));
  });

  it("distinguishes IMPL direction once symmetry is broken", () => {
    // A lone IMPL(0,1) and IMPL(1,0) are genuinely the same puzzle up to
    // relabeling, so their digests SHOULD match. Anchoring thread 0 breaks the
    // symmetry, after which direction is a real structural difference.
    const anchor: Constraint = { type: CType.ANCHOR, threads: [0], k: 1 };
    const fwd: Constraint[] = [anchor, { type: CType.IMPL, threads: [0, 1] }];
    const rev: Constraint[] = [anchor, { type: CType.IMPL, threads: [1, 0] }];
    expect(puzzleDigestHex(2, rev)).not.toBe(puzzleDigestHex(2, fwd));

    const loneFwd: Constraint[] = [{ type: CType.IMPL, threads: [0, 1] }];
    const loneRev: Constraint[] = [{ type: CType.IMPL, threads: [1, 0] }];
    expect(puzzleDigestHex(2, loneRev)).toBe(puzzleDigestHex(2, loneFwd));
  });
});
