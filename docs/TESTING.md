# TESTING — Gates, Acceptance Criteria, Vectors

Validation cadence (owner requirement): after every change, run unit tests + the relevant CLI verification. Phase 1 logic changes re-run the full 1,000-puzzle batch. No green batch, no merge.

---

## 1. Test vectors (`test/vectors/`) — the cross-implementation lock

Same discipline as Muhuri's cross-language vectors. Generated once in Phase 1, **append-only forever** (`fumbo vectors --emit` refuses to mutate existing entries).

- `wire/`: ≥40 canonical pairs of hex payload ↔ decoded JSON, covering: every constraint type, every kind, min/max arities, flag combinations, CRC-failure cases (must reject), unknown-type-ID case (must reject loudly), truncation cases (must reject).
- `solve/`: ≥30 puzzles with their canonical traces and certificates — solver reimplementations must reproduce traces **exactly** (same rule, same order). Tier-ordered greedy with fixed tie-breaking makes this deterministic; the vectors enforce it stays so.
- `grade/`: DifficultyVector expected outputs for the solve vectors.
- `sigil/`: (Phase 2) digest → sigil geometry parameter tuples, so sigils render identically across future ports.
- `layout/`: layoutSeed → rest-pose coordinates within ε=0.5dp tolerance (float determinism guard: fixed iteration count, no time-based stepping).

Any future Rust/Swift port passes the entire vector set before merge. This is the `mhr1_` playbook applied to `fmb1_`.

## 2. Phase gates (formal acceptance)

### Phase 1 — Logic core
- [ ] `fumbo batch --n 1000 --ladder`: 100% uniqueness, 100% deducibility at target tier, 0 R5-requiring puzzles
- [ ] Acceptance rate ≥5% per band (else fix topology priors, §GENERATOR 1)
- [ ] Grade distribution report shows all four bands populated
- [ ] Owner 30-puzzle blind solve: Spearman(scalar, solve time) ≥ 0.7
- [ ] Wire round-trip: encode(decode(x)) byte-identical for all wire vectors
- [ ] Perf budgets met (§GENERATOR 6)
- [ ] Vectors emitted and committed

### Phase 2 — Interaction
- [ ] **Stranger test:** a fresh player solves a T2 puzzle, zero written instructions, ≤5 minutes. Run with ≥3 strangers; 2/3 pass required. Fail ⟹ iterate here, ship nothing downstream.
- [ ] Gesture bijection audit: instrumented session log shows zero committed ops the tester disavows ("I didn't mean to assert that")
- [ ] ASSERT_FALSE variant decision made (flag removed, loser deleted)
- [ ] 60fps floor on reference mid-range Android device, 16-thread knot
- [ ] Contradiction localization comprehension: testers can point at "where the conflict was" after a snap-back

### Phase 3 — Daily loop
- [ ] Daily derivation is pure-client (seed schedule, no server dependency)
- [ ] Share card renders distinct at 120px thumbnail; URL round-trips to the correct puzzle/result on a clean device
- [ ] 20-person closed test instrumented via localStorage export
- [ ] **Gate: unprompted day-7 return** — target ≥8/20 opening the app on day 7 without a reminder ping. Below 5/20 ⟹ the ritual isn't pulling; diagnose (share loop? daily difficulty? solve payoff?) before Phase 4.

### Phase 4 — Tangle + adaptation
- [ ] Cold-start bracket: simulated players at scalar 1/5/12 each reach an 80%±10% solve-rate regime within 10 rated puzzles (run against scripted solver-bots at capped tiers)
- [ ] Can't/won't classifier: hand-labeled sample from Phase 3 logs, ≥85% agreement
- [ ] Off-modality injection fires at spec cadence; VOID outcomes produce no rating drift (property test)
- [ ] Worker generation p95 <120ms; buffer never empties in a 30-minute scripted session
- [ ] Telemetry: every event type emitted at least once in an end-to-end scripted run; schema validates

## 3. Property tests (continuous, all phases)

- Generator: ∀ emitted puzzle — connected, unique, deducible, layout-legal (fuzz with random seeds, 10k/CI-run)
- Solver: trace certificate re-verifies; solver never asserts a value contradicting the model-counted solution
- Retraction: assert-sequence + retract(x) ≡ replaying the sequence without x (recompute-from-scratch equivalence, §INTERACTION 4.3)
- Elo: bounded step size; VOID invariance; monotonicity (better outcomes never lower rating)
- Wire: fuzz decoder with random bytes — must reject, never crash, never partially apply

## 4. Reference devices

- Android mid-range 2021 (perf floor + haptics path)
- iPhone (Safari — no-vibrate compensation path, audio priming)
- Desktop Chrome + Firefox (mouse grammar parity)
