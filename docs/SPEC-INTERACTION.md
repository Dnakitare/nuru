# SPEC-INTERACTION — Gestures, Feedback, Layout Constraints

The recognizability bet lives here. Governing invariant: **strict bijection between committed gestures and formal operations.** If a playtester ever asks "wait, what did I just assert?", this spec has failed and iteration happens here before anything downstream.

---

## 1. Formal operations (the complete set)

| Op | Meaning (logic layer) |
|----|----------------------|
| ASSERT_TRUE(t) | player commits thread t = TRUE |
| ASSERT_FALSE(t) | player commits thread t = FALSE |
| TEST(t, v) | invoke R4.1 hypothetical on (t,v); costs focus |
| RETRACT(t) | withdraw a player assertion on t (and its dependents — §4.3) |

No other input ever reaches the logic layer. Camera pan/zoom, thread jiggling below threshold, and UI chrome are logic-inert by construction.

## 2. Gesture grammar

### 2.1 The detent principle
Every committing gesture must pass a **confirm-tension threshold**: drag distance > 24dp AND held direction stable, with a haptic detent (or visual snap on iOS web) at the threshold. Below threshold: the thread stretches elastically and springs back — free exploration, nothing committed. This single mechanism kills fat-finger assertions.

### 2.2 Mapping

- **ASSERT_TRUE:** grab thread, pull *outward* (away from knot centroid) past detent. Thread pulls taut, brightens, hums (short haptic buzz + rising tone).
- **ASSERT_FALSE:** two candidate designs — **Phase 2 implements both behind a flag** (HANDOFF open question 2):
  - *(a) Pull inward:* drag toward knot centroid past detent → thread goes slack, dims. Symmetric with TRUE; risk: centroid direction is ambiguous on some layouts.
  - *(b) Pinch-slack:* two-finger pinch along the thread past detent → slack/dim. Unambiguous direction-free; risk: two-finger on small screens.
  - Playtest decides; loser is deleted, not kept as an option (one grammar, no settings).
- **TEST:** long-press thread (400ms) → thread enters ghost mode (translucent shimmer) → then pull outward = TEST(t,TRUE) or the FALSE gesture = TEST(t,FALSE). On commit: focus meter drains (SPEC-PRODUCT §4), hypothetical propagation plays out in ghost rendering (§3.4).
- **RETRACT:** double-tap an asserted thread. Confirm affordance: thread wobbles once and requires a second tap within 600ms if the retraction would cascade (§4.3).
- **Pan/zoom:** one-finger drag on empty space / two-finger pinch on empty space. Threads have priority hit-targets; empty-space detection uses the clearance guarantee (§5).

### 2.3 Undo
Full undo stack of formal ops (not gestures). Two-finger tap = undo. Unlimited within a puzzle. Undo is free — punishing undo would push players toward mental brute-force instead of board brute-force, which is worse for the fiction and unmeasurable.

## 3. Feedback states (the feel spec)

The spring sim (`sim/`) drives everything; all effects are parameter changes on it, not baked animations.

### 3.1 Tension propagation (correct assertion)
Assertion consistent with the solution's forced consequences: the constraint graph propagates visually — connected threads shift tension over 300–600ms in *dependency order* (staggered by graph distance, 60ms/hop), so an inference chain reads as a chain. Sound: rising arpeggiated plucks, one per hop. This is the core dopamine moment; budget polish time here first.

### 3.2 Contradiction (assertion violates a constraint given current commitments)
The knot **strains**: local threads grind against each other (high-frequency low-amplitude spring oscillation), light stutters, dissonant creak, sharp haptic triple-pulse — then the assertion **snaps back** (auto-retract, 250ms). The player keeps no false state; contradiction is informative, not punitive. The straining *localizes* at the violated constraint's crossing — the player learns *where* the conflict is, which is itself a deduction aid and honest (it's information a careful reasoner would have).

Note: contradiction is evaluated against **constraints + current player commitments**, not against the hidden solution. Asserting something false-but-currently-consistent is *accepted* — it will strain later when it collides. This is crucial: the game never leaks the solution through instant right/wrong feedback; it only enforces logic. (Wrong-but-consistent states eventually dead-end and get retracted — that's the player experiencing modus tollens viscerally.)

### 3.3 Solve
All threads known + all constraints satisfied: knot pulls tight in sequence, then **collapses** — threads spiral inward and re-form as the sigil (deterministic geometry per SPEC-CORE §6) over ~1.2s. Sigil pulses once, then flies to the constellation. Longest, most lavish animation in the game; it is the screenshot.

### 3.4 TEST (ghost propagation)
Hypothetical plays in a ghost layer: translucent duplicate threads propagate tiers ≤3. Contradiction found ⟹ ghost shatters, the *real* thread auto-asserts the negation with full §3.1 propagation (the payoff for spending focus). No contradiction ⟹ ghost fades, nothing committed, focus still spent. (Spending focus to learn "inconclusive" is correct pricing — it's what makes players *reason about which test is decisive* instead of spamming tests.)

### 3.5 Hint
Idle > 45s with available inference, or explicit hint request: the relevant crossing shimmers softly (SPEC-GENERATOR §3.4). Never auto-fires during active manipulation.

## 4. State model

### 4.1 Thread visual states
UNKNOWN (neutral drift, mid-brightness) / ASSERTED_TRUE (taut, bright) / ASSERTED_FALSE (slack, dim) / GHOST (test mode) / ANCHOR (pinned end-cap, pre-lit, non-interactive)

### 4.2 Derived vs. player assertions
When a player assertion forces consequences via constraints, forced threads settle into their values with §3.1 propagation but render with a subtle "derived" treatment (thinner glow ring). Derived values retract automatically when their supporting assertion is retracted. Players cannot directly retract a derived thread — double-tapping it shimmers its *source* assertion (teaching the dependency structure).

### 4.3 Retraction cascade
RETRACT(t) removes t's assertion and re-derives the board from remaining player assertions (recompute forward from scratch — at v1 sizes this is instant and eliminates incremental-retraction bugs). If dependents will visibly change, the pre-confirm wobble (§2.2) warns.

## 5. Layout & legibility constraints (contract with the generator)

These numbers are inputs to SPEC-GENERATOR §2.1/§2.6 rejection:

- Min thread hit-target clearance: 44dp between any two thread midlines in rest pose
- Max crossings per 100dp² region: 3
- Max threads on screen without zoom at base viewport (390×700dp): 16; puzzles above 16 threads require the camera system and are gated to Tangle T3+
- All ANCHOR end-caps within the initial viewport (players must see the pull-in points without hunting)

## 6. Platform notes

- Pointer Events API only (unifies mouse/touch); no touch-event legacy path.
- Haptics: `navigator.vibrate` patterns on Android Chrome. iOS Safari: no vibration API — compensate with amplified visual detent (snap + flash) and audio tick. Audio must be primed on first user gesture (autoplay policy).
- 60fps floor on a 2021 mid-range Android device with a 16-thread knot. Spring sim on main thread is fine at v1 sizes; renderer uses a single canvas, no DOM-per-thread.
- Desktop (mouse) gets the same grammar; hover states may *preview* detent thresholds but commit rules are identical. One grammar everywhere.
