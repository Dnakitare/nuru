# SPEC-GENERATOR — Generation Pipeline, Deduction-Only Solver, Grading

Derives entirely from SPEC-CORE. Zero DOM dependencies; identical source runs in Node CLI (Phase 1) and browser Web Worker (Phase 4 Tangle mode).

---

## 1. Pipeline overview

```
request(targetDifficulty) 
  → topology sample 
  → constraint assignment 
  → uniqueness check          [reject/repair]
  → deducibility verification [reject]
  → grading 
  → target match check        [reject → resample]
  → layout pass 
  → emit Puzzle + certificate
```

All randomness flows from a single seeded PRNG (xoshiro128**, seed logged). Every emitted puzzle is reproducible from its seed — mandatory for bug reports and daily puzzle scheduling.

Rejection sampling is the honest architecture here: generation is cheap (<5ms typical), so reject freely rather than building clever repair logic. Target acceptance rate ≥5%; if a difficulty band's acceptance falls below that, tune the *topology priors* for that band, not the verifier.

### 1.1 Generation request

```ts
interface GenRequest {
  targetTier: 1|2|3|4;
  targetSteps: [min, max];
  threadCount: [min, max];
  constraintMix?: Partial<Record<ConstraintType, weight>>; // modality/variety shaping
  seed?: u32;
}
```

## 2. Stages

### 2.1 Topology sample
- Draw threadCount, then a connected multigraph: spanning tree first (guarantees connectivity), then extra edges up to a density target. Density prior scales with targetTier (T1 ≈ tree+1, T4 ≈ tree+threadCount/2).
- Hyperedges (COUNT_*) sampled as small subsets (arity 3–5) replacing local edge clusters, frequency by constraintMix.
- **Layout budget enforced at topology time:** projected crossing density must not exceed the render cap (SPEC-INTERACTION §5). Reject topologies that can't lay out legibly — deeper puzzles must grow through structure (longer chains, counting interplay), never through visual clutter. This is the mechanical enforcement of "difficulty ≠ density."

### 2.2 Constraint assignment
- Pick a random target assignment `A` (the intended solution) first.
- For each edge/hyperedge, choose a constraint type *consistent with A* (e.g., if a=T,b=F, eligible binary types: IMPL(b,a), NAND, XOR, OR…). This guarantees satisfiability by construction; only uniqueness and deducibility remain to verify.
- Place ANCHORs: start with 1, add more only if deducibility verification demands (see 3.3 repair loop). Fewer anchors = tighter puzzle.

### 2.3 Uniqueness check
- n ≤ 63 booleans: DPLL-style model counting with early exit at count 2. At v1 sizes (≤24 threads) this is microseconds. No SAT library dependency — write the 80-line DPLL; constraint types translate to clauses trivially (COUNT_* via direct propagation in the counter, not CNF expansion).
- Count ≠ 1 ⟹ reject (do not repair by adding anchors here; that skews difficulty — resample).

### 2.4 Deducibility verification → §3.

### 2.5 Grading → §4.

### 2.6 Layout pass
- Force-directed layout (springs on constraint edges, repulsion between threads), seeded by `layoutSeed`, iterated to rest.
- Post-check: max crossings per screen-region grid cell ≤ cap; min inter-thread clearance ≥ touch target (SPEC-INTERACTION §5). Fail ⟹ retry with new layoutSeed (up to 8), then reject puzzle.
- Output is *only* the seed — layout is recomputed deterministically at render. Keeps wire format tiny.

---

## 3. Deduction-only solver

The heart of the deducibility guarantee, the difficulty grader's instrument, and the hint engine. One implementation, three consumers.

### 3.1 Algorithm

```
state: value[threadId] ∈ {T, F, U}
loop:
  scan rules in tier order (R0 → R4.1)
  apply the FIRST available rule application (lowest tier wins; ties broken by constraint index)
  record step: {rule, constraint, thread, value, tier}
  until no rule applies or all threads known
solved := all known
```

- **Tier-ordered greedy is canonical.** It models a careful human who exhausts easy inferences before hypothesizing. The recorded sequence is the **canonical trace** — the single source of truth for grading and the certificate.
- R4.1 (HYPO_1) implementation: for each unknown thread × value, clone state, propagate tiers ≤3 to fixpoint, check contradiction. First contradiction found (scan order) is the canonical application. Cost is O(threads × propagation) per invocation — fine at v1 sizes.
- R5 is implemented (for analysis tooling) but **gated off** in verification: any puzzle needing R5 is rejected in v1.

### 3.2 Outputs

```ts
interface SolveResult {
  solved: boolean;
  trace: Step[];              // canonical trace
  certificate: string;        // SHA-256 of trace — stored with puzzle, re-verifiable
}
```

### 3.3 Verification & anchor repair
If unsolvable at target tier: allowed *one* repair round — add a single ANCHOR on the thread whose forced knowledge unlocks the longest downstream cascade (computed by trying each), then re-verify. Still failing ⟹ reject. One round only; anchor-stuffing produces flabby puzzles.

### 3.4 Hint engine (Phase 2+)
At any live game state, run one iteration of the solver scan; the found application's *constraint* is the hint target (shimmer the crossing). Never reveal the concluded thread value — point at the reason, not the answer. If only an R4 application exists, the hint shimmer indicates the hypothesis thread with a distinct "test here" treatment.

---

## 4. Grading

### 4.1 From the canonical trace, compute the DifficultyVector (SPEC-CORE §3):
- `maxTier`: max step tier
- `steps`: trace length
- `maxChain`: longest path in the step-dependency DAG (step B depends on step A if A's concluded thread appears in B's triggering constraint)
- `minWidth`: at each trace position, count *all* currently-available rule applications; take the minimum. Width 1 = only one way forward (feels tight/hard); width 4 = many entry points (feels open/easy).
- `hypoCount`: R4 steps

### 4.2 Human-anchoring requirement (Phase 1 gate)
The vector is theory until anchored. Phase 1 gate: 30-puzzle blind sample spanning the ladder, owner solve times recorded; Spearman correlation between `scalar` and solve time must be ≥0.7. If not, adjust §4.3 weights — **never** the rule taxonomy.

### 4.3 Scalar composite (initial weights, tunable per 4.2)

```
scalar = 1.0·maxTier + 0.05·steps + 0.30·maxChain + 0.50·(1/minWidth)·maxTier + 1.50·hypoCount
```

Weights live in one exported constant. Telemetry (Phase 4) will eventually refit them against population solve data; the vector fields themselves are frozen.

### 4.4 Tier bands (provisional, confirm at Phase 1 gate)
- T1: scalar < 3 — tutorial/calibration
- T2: 3–6 — Daily Knot band
- T3: 6–10 — Tangle mainstream
- T4: 10+ — Tangle frontier

---

## 5. CLI (Phase 1 deliverable)

```
fumbo gen    --tier 2 --steps 8..14 --threads 8..12 [--seed N] [--modality symbolic]
fumbo grade  <fmb1_...>            # print DifficultyVector + trace summary
fumbo verify <fmb1_...>            # uniqueness + deducibility + certificate check
fumbo batch  --n 1000 --ladder     # full gate run: generate across bands, verify all,
                                   # emit acceptance-rate + grade-distribution report
fumbo trace  <fmb1_...> --full     # human-readable canonical trace (debugging)
fumbo vectors --emit               # (re)generate test/vectors/ — append-only guard:
                                   # refuses to modify existing vector entries
```

`fumbo batch` output is the Phase 1 gate artifact — check the report into the repo.

---

## 6. Performance budgets

- gen+verify+grade single puzzle: <50ms p95 at ≤24 threads (Node, M-class laptop)
- Browser Worker (Tangle just-in-time generation): <120ms p95 — pre-generate a 3-puzzle buffer ahead of the player so latency is never visible
- Batch 1,000: <60s

Budgets are gates, not aspirations; exceeding them means the topology priors are producing pathological rejects — fix priors.
