# fmb (provisional: "Fumbo")

A tactile deduction game where logic puzzles materialize as knots of luminous
threads. The constraint graph is simultaneously the puzzle, the picture, the
difficulty rating, and the hint system.

Specs live in [`docs/`](docs/). Read order: `HANDOFF.md` → `SPEC-CORE.md` (the
frozen contract) → generator → interaction → product → adaptation → testing.

## Status

**Phase 1 — logic core (CLI only, no pixels): built, six of seven gate criteria
pass.** `core/`, `solver/`, `gen/` (minus layout), the CLI, and the append-only
test vectors are complete. The 1,000-puzzle batch gate is green (100%
uniqueness + deducibility, 0 R5, ≥5% acceptance per band, wire byte-identical,
p95 ≤1ms). See [`docs/PHASE1-BATCH.md`](docs/PHASE1-BATCH.md). The one open gate
item is the owner's 30-puzzle blind-solve human-anchoring (Spearman ≥0.7,
SPEC-GENERATOR §4.2) — it needs a human solving by hand.

## Layout

```
src/core/     graph model, constraint registry, fmb1_ wire format, canonical hash
src/solver/   deduction-only solver (R0–R4.1), canonical trace, certificate
src/gen/      generator pipeline, DPLL uniqueness, grading  (layout: Phase 2)
src/sim/ render/ input/ game/ adapt/   Phase 2+ (empty in Phase 1)
cli/          fumbo gen | grade | verify | batch | trace | vectors
test/vectors/ canonical, append-only cross-implementation vectors
```

`core/` and `solver/` have zero imports from anywhere else; dependency
direction is strictly downward through the list above.

## Commands

```
npm install
npm test                       # unit + property tests
npm run typecheck
npm run fumbo -- gen --tier 2   # generate a puzzle
npm run batch                   # Phase 1 gate: 1000-puzzle ladder run
```

The name "Fumbo" is provisional (HANDOFF open question 1); code identifiers use
the rename-safe `fmb` prefix.
