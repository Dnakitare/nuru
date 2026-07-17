// SPEC-CORE §5 — the fmb1_ wire format. Shareable, URL-safe, decodable-forever
// encodings of puzzles (kind 0) and results (kind 1). Binary, little-endian, no
// JSON. Field order within each kind is FROZEN; new fields append behind new
// flag bits only, new kinds append with the next id.
//
// Stability rules (§5.4): CRC mismatch, unknown type id, and truncation all
// reject loudly — never skip, never partially apply.

import { base64urlDecode, base64urlEncode, crc32 } from "./codec.js";
import { CType, isCountType, MAX_THREADS, metaFor, type Constraint } from "./types.js";
import type { WirePuzzle } from "./types.js";

export const WIRE_PREFIX = "fmb1_";

export const Kind = { PUZZLE: 0, RESULT: 1 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export const FLAG_SOLUTION = 0x01; // bit0 of the puzzle flags byte

// ── byte writer / reader ─────────────────────────────────────────────────────

class Writer {
  private buf: number[] = [];
  u8(v: number): void {
    this.buf.push(v & 0xff);
  }
  u16(v: number): void {
    this.buf.push(v & 0xff, (v >>> 8) & 0xff);
  }
  u32(v: number): void {
    this.buf.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  u64(v: bigint): void {
    for (let i = 0; i < 8; i++) this.buf.push(Number((v >> BigInt(i * 8)) & 0xffn));
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.buf);
  }
}

class Reader {
  private o = 0;
  constructor(private readonly b: Uint8Array) {}
  get offset(): number {
    return this.o;
  }
  private need(n: number): void {
    if (this.o + n > this.b.length) throw new Error("truncated payload");
  }
  u8(): number {
    this.need(1);
    return this.b[this.o++]!;
  }
  u16(): number {
    this.need(2);
    const v = this.b[this.o]! | (this.b[this.o + 1]! << 8);
    this.o += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v =
      (this.b[this.o]! | (this.b[this.o + 1]! << 8) | (this.b[this.o + 2]! << 16) | (this.b[this.o + 3]! << 24)) >>> 0;
    this.o += 4;
    return v;
  }
  u64(): bigint {
    this.need(8);
    let v = 0n;
    for (let i = 0; i < 8; i++) v |= BigInt(this.b[this.o + i]!) << BigInt(i * 8);
    this.o += 8;
    return v;
  }
  remaining(): number {
    return this.b.length - this.o;
  }
}

// ── envelope ─────────────────────────────────────────────────────────────────

/** Wrap a binary payload (crc32 already appended) in the fmb1_ envelope. */
function envelope(payloadWithCrc: Uint8Array): string {
  return WIRE_PREFIX + base64urlEncode(payloadWithCrc);
}

/** Strip the envelope, verify prefix, return the raw payload+crc bytes. */
function unwrap(s: string): Uint8Array {
  if (!s.startsWith(WIRE_PREFIX)) {
    // Distinguish a future format from garbage for a useful error.
    const m = /^fmb(\d+)_/.exec(s);
    if (m) throw new Error(`puzzle requires newer version (fmb${m[1]}_)`);
    throw new Error("not an fmb1_ payload");
  }
  return base64urlDecode(s.slice(WIRE_PREFIX.length));
}

/** Append crc32 of the body, then base64url-envelope it. */
function finish(w: Writer): string {
  const body = w.bytes();
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  const c = crc32(body);
  out[body.length] = c & 0xff;
  out[body.length + 1] = (c >>> 8) & 0xff;
  out[body.length + 2] = (c >>> 16) & 0xff;
  out[body.length + 3] = (c >>> 24) & 0xff;
  return envelope(out);
}

/** Verify and strip the trailing crc32, returning a Reader over the body. */
function openChecked(s: string): Reader {
  const all = unwrap(s);
  if (all.length < 5) throw new Error("truncated payload"); // 1 kind byte + 4 crc minimum
  const body = all.subarray(0, all.length - 4);
  const stored =
    (all[all.length - 4]! |
      (all[all.length - 3]! << 8) |
      (all[all.length - 2]! << 16) |
      (all[all.length - 1]! << 24)) >>>
    0;
  if (crc32(body) !== stored) throw new Error("crc mismatch: payload corrupt or tampered");
  return new Reader(body);
}

// ── puzzle payload (kind 0) ──────────────────────────────────────────────────

export interface EncodePuzzleOpts {
  /** Include the solution bitmask (flags bit0). MUST be false for shared links. */
  includeSolution?: boolean;
}

export function encodePuzzle(p: WirePuzzle, opts: EncodePuzzleOpts = {}): string {
  if (p.threadCount > MAX_THREADS) throw new Error(`threadCount ${p.threadCount} exceeds ${MAX_THREADS}`);
  if (p.constraints.length > 255) throw new Error("constraintCount exceeds 255");

  const includeSolution = opts.includeSolution === true && p.solution !== undefined;
  const w = new Writer();
  w.u8(Kind.PUZZLE);
  w.u8(p.threadCount);
  w.u8(p.constraints.length);
  w.u32(p.layoutSeed >>> 0);
  w.u8(includeSolution ? FLAG_SOLUTION : 0);

  for (const c of p.constraints) {
    const meta = metaFor(c.type);
    const arity = c.threads.length;
    if (arity < meta.minArity || arity > meta.maxArity) {
      throw new Error(`${meta.name} arity ${arity} outside [${meta.minArity},${meta.maxArity}]`);
    }
    w.u8(c.type);
    w.u8(arity);
    for (const t of c.threads) {
      if (t < 0 || t >= p.threadCount) throw new Error(`thread id ${t} out of range`);
      w.u8(t);
    }
    if (meta.hasK) w.u8((c.k ?? 0) & 0xff);
    else if (c.k !== undefined) throw new Error(`${meta.name} must not carry k`);
  }

  if (includeSolution) w.u64(p.solution!);
  return finish(w);
}

export function decodePuzzle(s: string): WirePuzzle {
  const r = openChecked(s);
  const kind = r.u8();
  if (kind !== Kind.PUZZLE) throw new Error(`expected puzzle payload, got kind ${kind}`);
  const threadCount = r.u8();
  if (threadCount > MAX_THREADS) throw new Error(`threadCount ${threadCount} exceeds ${MAX_THREADS}`);
  const constraintCount = r.u8();
  const layoutSeed = r.u32();
  const flags = r.u8();

  const constraints: Constraint[] = [];
  for (let i = 0; i < constraintCount; i++) {
    const type = r.u8();
    const meta = metaFor(type); // throws loudly on unknown id
    const arity = r.u8();
    if (arity < meta.minArity || arity > meta.maxArity) {
      throw new Error(`${meta.name} arity ${arity} outside [${meta.minArity},${meta.maxArity}]`);
    }
    const threads: number[] = [];
    for (let a = 0; a < arity; a++) {
      const t = r.u8();
      if (t >= threadCount) throw new Error(`thread id ${t} out of range`);
      threads.push(t);
    }
    const c: Constraint = meta.hasK ? { type: type as CType, threads, k: r.u8() } : { type: type as CType, threads };
    constraints.push(c);
  }

  let solution: bigint | undefined;
  if ((flags & FLAG_SOLUTION) !== 0) solution = r.u64();

  if (r.remaining() !== 0) throw new Error("trailing bytes after payload");
  return solution === undefined ? { threadCount, layoutSeed, constraints } : { threadCount, layoutSeed, constraints, solution };
}

// ── result payload (kind 1) ──────────────────────────────────────────────────

export const PuzzleRef = { DAILY: 0, INLINE_DIGEST: 1 } as const;
export type PuzzleRef = (typeof PuzzleRef)[keyof typeof PuzzleRef];

export type ResultRef =
  | { kind: typeof PuzzleRef.DAILY; dateCode: number } // u16
  | { kind: typeof PuzzleRef.INLINE_DIGEST; digest: Uint8Array }; // 8 bytes

export interface Result {
  ref: ResultRef;
  solved: boolean;
  durationSec: number; // capped 65535
  hintsUsed: number;
  testsUsed: number;
  maxTierExercised: number;
}

export function encodeResult(res: Result): string {
  const w = new Writer();
  w.u8(Kind.RESULT);
  w.u8(res.ref.kind);
  if (res.ref.kind === PuzzleRef.DAILY) {
    w.u16(res.ref.dateCode);
  } else {
    if (res.ref.digest.length !== 8) throw new Error("inline digest must be 8 bytes");
    for (const b of res.ref.digest) w.u8(b);
  }
  w.u8(res.solved ? 1 : 0);
  w.u16(Math.min(res.durationSec, 65535));
  w.u8(res.hintsUsed & 0xff);
  w.u8(res.testsUsed & 0xff);
  w.u8(res.maxTierExercised & 0xff);
  return finish(w);
}

export function decodeResult(s: string): Result {
  const r = openChecked(s);
  const kind = r.u8();
  if (kind !== Kind.RESULT) throw new Error(`expected result payload, got kind ${kind}`);
  const refKind = r.u8();
  let ref: ResultRef;
  if (refKind === PuzzleRef.DAILY) {
    ref = { kind: PuzzleRef.DAILY, dateCode: r.u16() };
  } else if (refKind === PuzzleRef.INLINE_DIGEST) {
    const digest = new Uint8Array(8);
    for (let i = 0; i < 8; i++) digest[i] = r.u8();
    ref = { kind: PuzzleRef.INLINE_DIGEST, digest };
  } else {
    throw new Error(`unknown puzzleRef kind ${refKind}: result requires newer version`);
  }
  const solved = r.u8() !== 0;
  const durationSec = r.u16();
  const hintsUsed = r.u8();
  const testsUsed = r.u8();
  const maxTierExercised = r.u8();
  if (r.remaining() !== 0) throw new Error("trailing bytes after payload");
  return { ref, solved, durationSec, hintsUsed, testsUsed, maxTierExercised };
}

/** Peek the kind byte without full decode (dispatch helper). */
export function peekKind(s: string): number {
  return openChecked(s).u8();
}
