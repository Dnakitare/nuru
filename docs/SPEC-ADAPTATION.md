# SPEC-ADAPTATION — Learner Model, Elo, Telemetry

Doctrine: **telemetry-first, actuation-later.** Log everything from Phase 3; drive behavior with only the simplest defensible model until data volume justifies more. The learner model is the long-term moat; the v1 actuation is deliberately boring.

---

## 1. v1 actuated model: two-dimension Elo

### 1.1 Dimensions
- **DEPTH:** player rating vs. puzzle `difficulty.scalar` mapped to an Elo scale: `puzzleElo = 800 + 120·scalar` (constants in one exported object, tunable).
- **MODALITY:** one rating offset per modality (SYMBOLIC baseline 0; VERBAL/NUMERIC offsets learned relative to it). Applied additively to effective player Elo when a puzzle is dressed in that modality.

### 1.2 Update rule
Standard Elo expected-score vs. binary outcome (solved without hints = 1; solved with hints = 0.5; abandoned after real effort = 0):

```
expected = 1 / (1 + 10^((puzzleElo − effectiveElo)/400))
delta    = K · (outcome − expected)
playerDepthElo += delta;  modalityOffset[m] += 0.3·delta
```

- **K-schedule (conservative by design):** K=32 for the first 20 rated puzzles (calibration), decaying linearly to K=12 by puzzle 60, floor 12. Slow adaptation that occasionally lags the player beats fast adaptation that occasionally insults them — trust is asymmetric.
- Daily Knot results update ratings at 0.5 weight (fixed-difficulty shared item; informative but off-frontier).

### 1.3 Puzzle selection (Tangle)
Target success band ≈ 80%: request generation at `scalar` such that expected ≈ 0.8, with a ±10% difficulty jitter so sessions breathe (all-frontier-all-the-time reads as grind). Every 6th puzzle: an off-modality item at expected ≈ 0.9 — the deliberate weak-modality injection at *reduced* difficulty. Growth without discouragement; this asymmetry is the adaptive thesis in one line of code.

### 1.4 Can't vs. won't discrimination
Before scoring an abandon as outcome 0, classify:
- **Effortful failure** (≥3 committed ops, ≥60s active): outcome 0, rating drops → easier next.
- **Disengagement** (near-zero ops, fast quit, or rapid random asserts with immediate retracts): outcome VOID — no rating change; next puzzle changes *modality or visual variety*, not difficulty. Conflating these is the "adaptive systems feel dumb" failure; this classifier, crude as it is, is the fix.

## 2. Logged-but-not-actuated (Phase 3 onward)

Recorded for future model versions; MUST NOT drive v1 behavior:
- Full op traces with timestamps (inference pace, pause-before-insight patterns)
- Per-rule-tier success/latency (which inference *types* the player finds hard — the future skill-dimension expansion beyond scalar depth)
- Session telemetry: length, visibilitychange events, time-of-day, steady rates (feeds the Phase 4+ attention-stretch curve)
- Hint/TEST usage patterns
- Replay/skip/share behavior (future motivation-type detection)

Actuation thresholds (do not cross earlier): per-tier skill modeling requires ≥200 rated puzzles/player AND ≥500 players pooled for prior-fitting; attention-stretch actuation requires ≥14 days of session data for that player.

## 3. Event schema

All events: `{ v: 1, t: epochMs, sid: sessionId, pid: anonPlayerId, type, ...payload }`. Type registry append-only (same discipline as constraint types):

| type | payload |
|------|---------|
| puzzle_start | puzzleDigest, scalar, tier, mode(daily/tangle), modality |
| op | op(assert_t/assert_f/test/retract/undo), threadId, msSinceLast |
| derive_cascade | sourceOp index, forcedCount, maxHopDepth |
| contradiction | constraintIdx, msIntoSession |
| hint | trigger(idle/request), constraintIdx |
| focus_change | direction(drain/fill), cause(visibility/test/steady) |
| puzzle_end | outcome(solved/abandon_effort/abandon_disengage), durationMs, hintsUsed, testsUsed, steady(bool) |
| elo_update | dim, before, after, k |
| share | kind(daily/tangle), channelHint? |
| session_end | activeMs, puzzles, visibilityBreaks |

v1 storage: localStorage ring buffer + optional POST to a single collection endpoint when one exists (Phase 3 closed test can run entirely on exported localStorage dumps from the 20 testers — no backend build required to hit the Phase 3 gate). Anonymous ID, no accounts in v1, no PII anywhere in the schema.

## 4. Cold start

Onboarding sequence (SPEC-PRODUCT §5) doubles as calibration: puzzles 1–3 unrated; puzzle 4 starts the ladder at scalar 4 (mid-T2); staircase ±1.5 scalar per result for the first 6 rated puzzles (fast bracket), then hand off to Elo with the K=32 phase. A 9-year-old and a chess player separate within ~8 puzzles without either noticing an assessment happened.

## 5. Trust rules (product-level constraints on this engine)

- Never display ratings, difficulty numbers, or "adjusted for you" copy. (Sigil complexity is the only mirror.)
- Never step difficulty down more than one band between consecutive puzzles regardless of Elo math — visible collapse reads as condescension.
- The player can always *choose* a harder knot (a "deeper" affordance in Tangle, one tap); chosen-harder failures score at 0.25 weight. Agency is part of trust; the engine advises, the player can overrule.
