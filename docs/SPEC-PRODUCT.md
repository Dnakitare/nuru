# SPEC-PRODUCT — Daily Knot, Tangle, Sigils, Focus Economy

Two loops with cleanly separated jobs: **Daily Knot** = acquisition + ritual; **Tangle** = retention + learning. The sigil constellation bridges them and carries the honest metric.

---

## 1. Daily Knot

- One shared constraint graph worldwide per UTC day. **Shared structure, adaptive dressing:** identical graph for everyone (comparable sigils/results); modality skin resolved per-player at render (SPEC-CORE §4).
- Fixed difficulty band: T2 (provisional — HANDOFF open question 3). Accessible ritual, not the learning frontier.
- Scheduling: puzzles pre-generated in batches by the CLI (`fumbo gen --tier 2` with date-derived seeds), hand-screened by owner (play each before it ships — Wordle-era lesson: one bad daily damages the ritual disproportionately), committed to a static schedule file. **No server required for v1** — the daily is derived from a published seed; the client generates it locally. Static hosting only.
- One attempt per day counts for the shared result; replays allowed but marked practice.
- Miss a day: streak uses the "streak freeze" pattern — 1 banked freeze earned per 7-day run, auto-applied. Streak pressure without streak terror; terror produces resentful churn, not retention.

## 2. Tangle (endless adaptive mode)

- Just-in-time generation in a Web Worker against the player's current Elo frontier (SPEC-ADAPTATION), 3-puzzle buffer.
- Difficulty ranges freely T1–T4. This is where the learner model actually trains the player.
- Session framing: puzzles chain visually — solving one knot's sigil becomes a "seed" the next knot grows from (pure presentation; no logic coupling). Gives sessions a sense of continuity without levels/worlds content-authoring.

## 3. Sigils & the constellation

- Sigil = deterministic function of `(puzzleDigest, difficulty.scalar)` (SPEC-CORE §6). Algorithm: digest bytes seed a radial glyph — N-fold symmetry where N = threadCount clamp 3..8, ring count = maxTier, stroke complexity scales with scalar. Simple T1 sigils are visibly plainer than T4 sigils **by construction** — the collection IS the trajectory chart.
- Constellation screen: sigils placed on a slowly growing spiral, chronological. A month of play shows, at a glance, early-plain → recent-intricate. This is the only surfaced form of the learner model (adaptation-invisibility invariant), and it's the honest metric: complexity shown is complexity *solved*, player-verifiable by tapping any sigil to replay its puzzle.
- **Share artifact:** solve screen offers a share card — sigil render + depth/time signature ("T3 · 4:12 · no tests") + daily number + URL. Result payload rides the URL as `fmb1_` kind-1 (spoiler-free by wire-format design, SPEC-CORE §5.3). Receiver's link opens the same daily (or the puzzle itself for Tangle shares) — the acquisition loop. Share card is a canvas render → PNG; must look distinct at thumbnail size (dark field, luminous sigil — the Wordle-grid test: recognizable in a feed at 120px).

## 4. Focus economy (the steady hand)

One resource doing two jobs: anti-interruption and anti-brute-force.

- **Focus meter** per puzzle session. Fills slowly during active, unbroken engagement (interaction or deliberate stillness with the app foregrounded); visibly drains on `visibilitychange` → hidden (app-switch, notification pull). Never below a floor of 1 TEST — the mechanic shapes behavior; it must never hard-lock a stuck player.
- **TEST costs focus** (SPEC-INTERACTION §3.4): 1 unit; meter caps at 3. Reasoning is free; hypothesizing is budgeted; brute force is priced out mechanically.
- **Steady bonus:** solving with zero mid-puzzle app-switches grants a "steady" mark on the sigil (small clean halo) and a streak multiplier on constellation growth speed. Superlinear reward for unbroken sessions — the attention curve. Never moralize in copy: no "you got distracted!" messaging, ever. The knot loosening slightly on return says it diegetically.
- **Adaptive stretch (Phase 4+, telemetry-gated):** target session lengths and steady thresholds fit to the player's demonstrated attention span, stretched ~10% per week of consistency. Logged from Phase 3; actuated only per SPEC-ADAPTATION thresholds.

## 5. Onboarding (the calibration disguise)

First-run: no menus — a single small knot is already on screen. Three-puzzle sequence:
1. 3 threads, ANCHOR + one IMPL + one XOR — teaches pull-TRUE and propagation (T1, unfailable)
2. 5 threads — introduces the FALSE gesture and contradiction snap-back
3. 7 threads with a COUNT ring — first real deduction
Then a fourth puzzle pitched at T2: this is the first calibration item; the staircase continues invisibly in Tangle. Total time ≈ 3–4 minutes. Zero text beyond ≤3-word floating labels ("pull" / "test"); the Phase 2 gate (stranger solves unassisted) proves most of this can be cut too.

## 6. Monetization stance (v1: none)

v1 is free, no ads, no IAP — distribution and ritual-proof come first (PhotoPare lesson: product model without distribution surface is the failure mode; earn the surface first). Post-traction candidates, in order of fit: one-time unlock for modality packs + constellation themes (Jam Jar-style cosmetic-adjacent, index-stable), never pay-for-hints (sells brute force, poisons the thesis), never ads (poisons the focus economy). Decision deferred; nothing in v1 architecture may preclude the one-time-unlock path (keep entitlement check stubbed).

## 7. Copy & tone

Sparse, lowercase-calm, zero gamification-speak ("streak" is the only borrowed term). No exclamation points. The product's voice is the quiet confidence of the knot itself. Name strings centralized in one file — "Fumbo" is provisional (HANDOFF open question 1).
