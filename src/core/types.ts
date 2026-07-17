// SPEC-CORE §1–3. The domain model, the append-only constraint registry, and
// the difficulty vector. This file is the contract; nothing here is renumbered
// or repurposed — new constraint types and rules only ever append.
//
// core/ imports from nowhere. Keep it that way.

export const FORMAT_VERSION = 1 as const;

/** Max threads per puzzle (SPEC-CORE §1.1). v1 practical max ~24. */
export const MAX_THREADS = 63;

// ── Truth values ────────────────────────────────────────────────────────────
// A committed thread value is a Bool (0/1). A solver cell is a Val (adds UNKNOWN).

export const Val = { FALSE: 0, TRUE: 1, UNKNOWN: -1 } as const;
export type Val = (typeof Val)[keyof typeof Val];
export type Bool = 0 | 1;

// ── Constraint type registry (SPEC-CORE §1.2, APPEND-ONLY) ───────────────────
// IDs are frozen. A decoder meeting an unknown ID must fail loudly, never skip.

export const CType = {
  ANCHOR: 0, // arity 1 — thread has given value (payload bit in `k`)
  IMPL: 1, //   arity 2 — threads[0] → threads[1]  (directional)
  XOR: 2, //    arity 2 — exactly one true
  NAND: 3, //   arity 2 — not both true
  OR: 4, //     arity 2 — at least one true
  EQUIV: 5, //  arity 2 — same value
  COUNT_EQ: 6, // arity 2..6 — exactly k of n true
  COUNT_LE: 7, // arity 2..6 — at most k true
  COUNT_GE: 8, // arity 2..6 — at least k true
} as const;
export type CType = (typeof CType)[keyof typeof CType];

export interface CTypeMeta {
  readonly id: CType;
  readonly name: string;
  readonly minArity: number;
  readonly maxArity: number;
  /** Whether the wire form carries a `k` byte for this type (§5.2). */
  readonly hasK: boolean;
}

/** Registry indexed by type ID. Order is the frozen ID order. */
export const CONSTRAINT_REGISTRY: readonly CTypeMeta[] = [
  { id: CType.ANCHOR, name: "ANCHOR", minArity: 1, maxArity: 1, hasK: true },
  { id: CType.IMPL, name: "IMPL", minArity: 2, maxArity: 2, hasK: false },
  { id: CType.XOR, name: "XOR", minArity: 2, maxArity: 2, hasK: false },
  { id: CType.NAND, name: "NAND", minArity: 2, maxArity: 2, hasK: false },
  { id: CType.OR, name: "OR", minArity: 2, maxArity: 2, hasK: false },
  { id: CType.EQUIV, name: "EQUIV", minArity: 2, maxArity: 2, hasK: false },
  { id: CType.COUNT_EQ, name: "COUNT_EQ", minArity: 2, maxArity: 6, hasK: true },
  { id: CType.COUNT_LE, name: "COUNT_LE", minArity: 2, maxArity: 6, hasK: true },
  { id: CType.COUNT_GE, name: "COUNT_GE", minArity: 2, maxArity: 6, hasK: true },
];

export function metaFor(type: number): CTypeMeta {
  const m = CONSTRAINT_REGISTRY[type];
  if (m === undefined) {
    throw new Error(`unknown constraint type ${type}: puzzle requires newer version`);
  }
  return m;
}

export function isCountType(type: number): boolean {
  return type === CType.COUNT_EQ || type === CType.COUNT_LE || type === CType.COUNT_GE;
}

// ── Puzzle objects (SPEC-CORE §1.1, §1.3) ────────────────────────────────────

export interface Thread {
  readonly id: number; // dense, 0-indexed
  readonly modalitySlot: number; // indexes the content table; logic never reads it
}

export interface Constraint {
  readonly type: CType;
  readonly threads: readonly number[]; // thread ids, in significant order
  readonly k?: number; // ANCHOR: given value 0/1. COUNT_*: threshold. Else absent.
}

export interface DifficultyVector {
  readonly maxTier: number; // highest rule tier required (1–4)
  readonly steps: number; // total inference steps in canonical trace
  readonly maxChain: number; // longest forced dependency chain
  readonly minWidth: number; // available inferences at the scarcest point (1 = tight)
  readonly hypoCount: number; // R4 applications required (0 for T≤3)
  readonly threadCount: number;
  readonly scalar: number; // grader's composite; derived, never authored
}

export interface Puzzle {
  readonly formatVersion: typeof FORMAT_VERSION;
  readonly threads: readonly Thread[];
  readonly constraints: readonly Constraint[];
  readonly solution: bigint; // bit i = thread i's value; stripped from shared wire form
  readonly difficulty: DifficultyVector;
  readonly layoutSeed: number; // u32; deterministic layout reproduction (Phase 2)
  readonly contentTableRef: string; // modality content, resolved at render (§4)
}

/**
 * The subset of a puzzle that the wire format carries (SPEC-CORE §5.2). Thread
 * `modalitySlot` defaults to `id` in v1, and difficulty/contentTableRef are
 * derived at load, so they are not on the wire.
 */
export interface WirePuzzle {
  readonly threadCount: number;
  readonly layoutSeed: number;
  readonly constraints: readonly Constraint[];
  readonly solution?: bigint; // present iff flags bit0 (private/local only)
}

/** Reconstruct dense threads for a wire puzzle (modalitySlot defaults to id). */
export function threadsOf(threadCount: number): Thread[] {
  const out: Thread[] = [];
  for (let i = 0; i < threadCount; i++) out.push({ id: i, modalitySlot: i });
  return out;
}

/** Read thread i's value out of a solution bitmask. */
export function bitAt(solution: bigint, i: number): Bool {
  return Number((solution >> BigInt(i)) & 1n) as Bool;
}
