# SPEC-CORE — Constraint Graph Model, Inference Rules, Wire Format

**Status: CONTRACT ARTIFACT.** This spec is the `mhr1_`-equivalent for Fumbo. All other components derive from it. Changes require owner approval and a format version bump. All registries herein are **append-only**.

---

## 1. Domain model

A **puzzle** is a propositional constraint-satisfaction problem over boolean variables, with exactly one satisfying assignment, guaranteed solvable by the deduction-only solver (SPEC-GENERATOR §3) at or below its target tier.

### 1.1 Threads (variables)

- `Thread`: `{ id: u8, modalitySlot: u8 }`
- `id` is dense, 0-indexed, max 63 threads per puzzle (v1 practical max ~24).
- Truth values: `TRUE` (thread pulled taut / bright), `FALSE` (thread slack / dim), `UNKNOWN` (initial).
- `modalitySlot` indexes into the puzzle's content table (§4) — what the thread's claim *says* in the current modality skin. **The logic layer never reads content.** Content is presentation only.

### 1.2 Constraints (crossings)

`Constraint`: `{ type: u8, threads: u8[], k?: u8 }`

**Constraint type registry (APPEND-ONLY):**

| ID | Name | Arity | Semantics | Rendered as |
|----|------|-------|-----------|-------------|
| 0 | ANCHOR | 1 | thread has given value (payload bit) | pinned thread end, pre-lit |
| 1 | IMPL | 2 | threads[0] → threads[1] | directional crossing (over/under) |
| 2 | XOR | 2 | exactly one true | twist crossing |
| 3 | NAND | 2 | not both true | barred crossing |
| 4 | OR | 2 | at least one true | braided crossing |
| 5 | EQUIV | 2 | same value | parallel binding |
| 6 | COUNT_EQ | 2..6 | exactly k of n true | ring cluster, k pips |
| 7 | COUNT_LE | 2..6 | at most k true | ring cluster, open top |
| 8 | COUNT_GE | 2..6 | at least k true | ring cluster, closed top |

Rules for extending: new types append with the next ID. Never renumber, never repurpose, never change arity or semantics of an existing ID. A decoder encountering an unknown type ID must fail loudly with "puzzle requires newer version," never skip.

ANCHOR payload: for type 0, `k` field carries the given value (0/1).

### 1.3 Puzzle object

```ts
interface Puzzle {
  formatVersion: 1;
  threads: Thread[];
  constraints: Constraint[];
  solution: bigint;        // bitmask, thread i's value at bit i — stripped from shared wire form
  difficulty: DifficultyVector;  // §3
  layoutSeed: u32;         // deterministic layout reproduction
  contentTableRef: string; // modality content, resolved at render (§4)
}
```

**Well-formedness (validator must enforce):**
- Constraint graph is connected (one knot, not several).
- Every thread appears in ≥1 non-ANCHOR constraint.
- ≥1 ANCHOR exists (the pull-in point for deduction).
- Exactly one satisfying assignment (model counting, §GENERATOR 2.4).
- Deducibility certificate present (§GENERATOR 3).

---

## 2. Inference rule taxonomy

This is the deduction-only solver's complete rule set and simultaneously the difficulty ladder and hint source. **Rule IDs are append-only.** Tiers group rules by cognitive weight.

### Tier 0 — Given
- **R0 ANCHOR_PROP:** an ANCHOR constraint sets its thread's value.

### Tier 1 — Local forcing (single constraint, single step)
- **R1.1 IMPL_MP:** IMPL(a,b), a=T ⟹ b=T (modus ponens)
- **R1.2 IMPL_MT:** IMPL(a,b), b=F ⟹ a=F (modus tollens)
- **R1.3 XOR_RES:** XOR(a,b), a known ⟹ b = ¬a
- **R1.4 NAND_RES:** NAND(a,b), a=T ⟹ b=F
- **R1.5 OR_RES:** OR(a,b), a=F ⟹ b=T
- **R1.6 EQUIV_COPY:** EQUIV(a,b), a known ⟹ b = a

### Tier 2 — Counting
- **R2.1 COUNT_SAT:** COUNT_EQ(S,k): if #T in S = k ⟹ all UNKNOWN in S = F; if #F = |S|−k ⟹ all UNKNOWN = T. (Analogues for LE/GE.)
- **R2.2 COUNT_BOUND:** LE/GE boundary forcing (at-most-k already has k trues ⟹ rest false; at-least-k has |S|−k falses ⟹ rest true).

### Tier 3 — Chaining (multi-constraint, still deterministic)
- **R3.1 IMPL_CHAIN:** transitive closure over IMPL edges — a=T at the head of an implication chain forces the chain. (Mechanically identical to repeated R1.1/R1.2; tracked separately because *humans experience chain length as difficulty* — the grader counts chain depth, the solver may implement it as R1 iteration with chain-length bookkeeping.)
- **R3.2 EQUIV_CLASS:** union-find over EQUIV edges; one member known ⟹ class known.

### Tier 4 — Shallow hypothetical (the TEST gesture's formal meaning)
- **R4.1 HYPO_1:** assume thread t = v; propagate Tier ≤3 only; if contradiction ⟹ t = ¬v. Depth-1, no nesting.

### Tier 5 — Deep hypothetical (v1 generator NEVER requires this; reserved)
- **R5.1 HYPO_2:** as R4.1 but one level of nesting permitted.

**Hard rule for v1:** the generator's target tiers are T1–T4. T4 puzzles appear only in Tangle mode at the adaptive frontier, never in the Daily Knot. No emitted puzzle may *require* R5.

**Hint semantics:** a hint = the lowest-tier rule application currently available on the board, rendered as a shimmer on the constraint's crossing (not on the thread — point at the *reason*, not the answer).

---

## 3. Difficulty vector

Computed from the canonical solve trace (SPEC-GENERATOR §4). Field order is fixed and append-only.

```ts
interface DifficultyVector {
  maxTier: u8;        // highest rule tier required (1–4)
  steps: u16;         // total inference steps in canonical trace
  maxChain: u8;       // longest forced dependency chain
  minWidth: u8;       // available inferences at the scarcest point (1 = tight)
  hypoCount: u8;      // number of R4 applications required (0 for T≤3)
  threadCount: u8;
  scalar: f32;        // grader's composite (SPEC-GENERATOR §4.3); for sorting/Elo only, derived, never authored
}
```

`scalar` is the single number the Elo engine consumes; the full vector is what the generator targets and telemetry records.

---

## 4. Modality content tables

The same constraint graph renders in different modalities. A **content table** maps `modalitySlot` → claim presentation:

- **SYMBOLIC** (v1 default): abstract glyph per thread; constraints are pure visual grammar. Zero localization cost, purest form of the game.
- **VERBAL:** short claim strings ("The key is brass"), constraints get connective phrases on hover.
- **NUMERIC:** threads carry quantities; constraints read as arithmetic relations.

v1 ships SYMBOLIC fully and VERBAL for the Daily Knot dressing experiment. NUMERIC is schema-reserved. Content tables live outside the wire format (referenced by `contentTableRef`), so a shared puzzle URL is modality-independent — the receiver's engine dresses it in their modality. This is what makes "shared structure, adaptive dressing" (SPEC-PRODUCT §2) work.

---

## 5. Wire format — `fmb1_`

Purpose: shareable, URL-safe, decodable-forever encodings of puzzles and results.

### 5.1 Envelope

```
fmb1_<base64url(payload)>
```

- Prefix `fmb1_` is the format+version tag. Future formats append (`fmb2_`); decoders must support all prior versions forever.
- base64url, no padding.
- Payload is binary, little-endian, layout below. No JSON in the wire form.

### 5.2 Puzzle payload (kind 0)

```
offset  size  field
0       1     kind = 0x00 (puzzle)
1       1     threadCount (≤63)
2       1     constraintCount
3       4     layoutSeed (u32 LE)
7       1     flags (bit0: solution present — private/local only, MUST be 0 in shared links)
8       var   constraints[]: each = type(1) + arity(1) + threadIds(arity) + k(1, present iff type∈{0,6,7,8})
var     8     solution bitmask (u64 LE) — present iff flags bit0
var     4     crc32 of preceding bytes
```

Thread `modalitySlot` defaults to `id` (slot table omitted in v1; a future flag bit will add an explicit table — append-only flag semantics).

### 5.3 Result payload (kind 1) — the share artifact's data half

```
0       1     kind = 0x01
1       1     puzzleRef kind: 0=daily(dateCode u16 follows), 1=inline fmb1 puzzle digest (8-byte truncated SHA-256)
var     ref   as above
var     1     solved (0/1)
var     2     durationSec (u16, capped 65535)
var     1     hintsUsed
var     1     testsUsed (R4 invocations)
var     1     maxTierExercised
var     4     crc32
```

Deliberately excludes the inference path itself — share artifacts must be spoiler-free (SPEC-PRODUCT §3).

### 5.4 Stability rules

1. Field order within a kind is frozen. New fields append behind new flag bits only.
2. New kinds append (kind 2, 3, …).
3. CRC mismatch ⟹ reject loudly.
4. **Cross-implementation lock:** `test/vectors/` contains canonical hex payload ↔ decoded-object pairs. Any second implementation (future Rust/Swift) must pass the identical vector set before merging — same discipline as Muhuri's cross-language vectors. Vectors are generated in Phase 1 and are themselves append-only.

---

## 6. Canonical graph hash & sigil determinism

`puzzleDigest = SHA-256` over the canonical serialization: constraints sorted by (type, sorted threadIds, k), thread IDs renumbered by first appearance in that sorted order. Two structurally identical puzzles hash identically regardless of authoring order.

The sigil (SPEC-PRODUCT §3) is a pure function of `(puzzleDigest, difficulty.scalar)` — deterministic, so everyone who solves the Daily Knot earns the *same* sigil geometry, and Tangle sigils grow with difficulty. Sigil rendering algorithm lives in SPEC-PRODUCT; the determinism guarantee lives here because it depends on the canonical hash.
