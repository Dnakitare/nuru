# FUMBO — Claude Code Handoff Package

**Project:** Fumbo (Swahili: "riddle") — a tactile deduction game where logic puzzles materialize as knots of luminous threads. Pulling threads asserts truth values; correct deduction propagates tension through the knot; solving collapses it into a unique geometric sigil.

**Owner:** D (Dnakitare)
**Package version:** 1.0
**Date:** 2026-07-17

---

## Read order

1. `HANDOFF.md` (this file) — context, phases, gates, invariants
2. `SPEC-CORE.md` — **THE CONTRACT ARTIFACT.** Constraint graph model, inference-rule taxonomy, `fmb1_` wire format. Everything else derives from this. Treat it like a wire-format spec: changes require explicit owner approval and a version bump.
3. `SPEC-GENERATOR.md` — generation pipeline, deduction-only solver, difficulty grading
4. `SPEC-INTERACTION.md` — gesture↔logic bijection, visual/haptic states, layout constraints
5. `SPEC-PRODUCT.md` — Daily Knot, Tangle mode, sigils, focus economy
6. `SPEC-ADAPTATION.md` — per-dimension Elo, telemetry schema (log-first, actuate-later)
7. `TESTING.md` — phase gates, acceptance criteria, test vector requirements

---

## The sacred invariant

**The constraint graph is simultaneously: the puzzle, the picture, the difficulty rating, and the hint system.**

- Puzzle: threads = boolean claims, crossings = constraints
- Picture: the rendered knot IS the graph (no translation layer)
- Difficulty: the deduction-only solver's trace over the graph IS the difficulty vector
- Hints: the solver's next legal inference IS the hint (rendered as thread shimmer)

Any feature that requires breaking this identity is the feature to cut. If you find yourself building a mapping table between "game state" and "logic state," stop — they are the same object.

## Secondary invariants

1. **Deducibility over uniqueness.** Every emitted puzzle must be solvable by the deduction-only solver using only rules at or below its target tier. Unique-but-guessy puzzles are rejected at generation. No exceptions.
2. **Gesture bijection.** Every committed gesture maps to exactly one formal operation (ASSERT_TRUE, ASSERT_FALSE, TEST, RETRACT). No gesture is ever ambiguous about what logical assertion it made. Exploration touches (below the detent threshold) map to nothing.
3. **Index stability** (Jam Jar lesson). The constraint-type registry, rule-tier IDs, and wire-format field order are append-only. New constraint types and rules get new IDs; existing IDs are never renumbered or repurposed. Share links must decode forever.
4. **Adaptation is invisible.** No difficulty menus, no "we made it easier" messaging. The only surfaced artifact of the learner model is the player's own trajectory (sigil complexity over time).
5. **Reasoning is mechanically cheaper than guessing.** The focus economy (TEST costs focus) is the enforcement mechanism, not moralizing copy.

---

## Tech stack (v1)

- **TypeScript, strict mode.** Single-page web app. Vite build.
- **Canvas 2D** for the knot renderer (WebGL is a v2 optimization; do not reach for it in v1).
- **No framework** for the game surface. Plain TS + DOM for chrome. (Owner preference: single-file-ish, surgical-edit-friendly architecture. Keep module count low and boundaries obvious.)
- **Spring simulation:** hand-rolled, ~200 lines. Verlet or semi-implicit Euler. No physics engine dependency.
- **Solver/generator:** pure TS, zero DOM dependencies, runs in Node (CLI) and browser (Web Worker) from the same source. This is mandatory — Phase 1 is CLI-only.
- **Persistence:** localStorage for v1 (player state, sigil collection, Elo state). Schema versioned from day one (`schemaVersion` field, migration function stubs).
- **Haptics:** `navigator.vibrate` where available (Android). iOS web gets visual tension compensation (see SPEC-INTERACTION). Do not block on haptics parity.
- **Sharing:** URL-encoded puzzles + results via `fmb1_` wire format. Zero-install virality is the distribution strategy; the URL is the product surface.

Repo layout:

```
fumbo/
  src/
    core/          # graph model, constraint registry, wire format  ← SPEC-CORE
    solver/        # deduction-only solver, rule implementations    ← SPEC-CORE/GENERATOR
    gen/           # generator pipeline, grading, layout            ← SPEC-GENERATOR
    sim/           # spring/tension simulation
    render/        # canvas knot renderer, sigil renderer
    input/         # gesture recognition → logic ops                ← SPEC-INTERACTION
    game/          # session state, focus economy, daily/tangle     ← SPEC-PRODUCT
    adapt/         # Elo, telemetry                                 ← SPEC-ADAPTATION
  cli/             # Phase 1 tooling: generate, grade, verify, batch
  test/
    vectors/       # canonical test vectors (see TESTING.md)
  index.html
```

`core/` and `solver/` must have zero imports from anywhere else. Dependency direction is strictly downward in the list above.

---

## Phases and gates

**Phase 1 — Logic core (CLI only, no pixels).**
Build: `core/`, `solver/`, `gen/` minus layout. CLI: `fumbo gen`, `fumbo grade`, `fumbo verify`, `fumbo batch`.
**Gate:** 1,000 generated puzzles across the difficulty ladder; 100% pass deducibility verification; difficulty grades monotonically correlate with owner's blind solve times on a 30-puzzle sample; wire format round-trips byte-identical; test vectors locked.

**Phase 2 — Interaction prototype.**
Build: `sim/`, `render/`, `input/`. One knot on screen, full gesture bijection, tension propagation, contradiction snap-back, collapse-to-sigil. No menus, no product features.
**Gate:** a stranger solves a T2 (mid-tier) puzzle with zero written instructions. If the verb doesn't teach itself, iterate here indefinitely. Nothing downstream matters until this passes.

**Phase 3 — Daily Knot loop.**
Build: daily puzzle scheduling, sigil share artifact (image + URL), result encoding, 20-person closed test.
**Gate:** unprompted day-7 return from the closed group.

**Phase 4 — Tangle + adaptation, public web launch.**
Build: endless mode, 2-dimension Elo (depth, modality) with conservative K, full telemetry logging, sigil constellation screen.
**Gate:** launch. Elo actuation stays conservative until data volume justifies otherwise (SPEC-ADAPTATION thresholds).

**Post-traction (not in this package):** native wrap (Capacitor or SwiftUI shell), full focus-economy build-out, quarterly open assessment, Palace skin on the proven engine.

---

## Working style requirements (owner preferences)

- Surgical `str_replace`-style edits over wholesale rewrites once files exist.
- Architecture-first reasoning in commit messages and PR descriptions: state *why* before *what*.
- Validate after every change: `npm test` + the relevant CLI verification command. Phase 1 changes must re-run the 1,000-puzzle batch.
- Blunt assessment in status reports. If a spec decision is wrong, say so with the argument; do not silently work around it.
- Any deviation from SPEC-CORE requires stopping and flagging, not improvising. It is the wire-format-equivalent contract.

## Open questions (owner decisions pending — do not resolve unilaterally)

1. Name collision check for "Fumbo" (npm, App Store, domains) has NOT been run. Treat the name as provisional; keep it out of code identifiers where practical (use `fmb` prefix, which survives a rename).
2. ASSERT_FALSE gesture: two candidates specified in SPEC-INTERACTION §3; Phase 2 prototype must implement both behind a flag for playtest comparison.
3. Daily Knot fixed depth: provisionally T2. Confirm after Phase 3 telemetry.
