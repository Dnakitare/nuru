// SPEC-CORE §2 — the inference rule taxonomy as data. Rule IDs are append-only
// and encode their tier (id<10 ⇒ tier 0; else floor(id/10)). The two-digit
// scheme leaves room to append within a tier without renumbering.
//
// Note on Tier 3: R3_1/R3_2 are reserved but the solver never emits them. Under
// tier-ordered greedy ("lowest tier wins") and the spec's own statement that
// chaining is "mechanically identical to repeated R1", R1 always preempts R3.
// Chain difficulty is captured by the grader's maxChain, not by a distinct
// step. R5_1 is implemented for analysis tooling but gated off in verification.

export const Rule = {
  R0: 0, // ANCHOR_PROP
  R1_1: 11, // IMPL_MP
  R1_2: 12, // IMPL_MT
  R1_3: 13, // XOR_RES
  R1_4: 14, // NAND_RES
  R1_5: 15, // OR_RES
  R1_6: 16, // EQUIV_COPY
  R2_1: 21, // COUNT_SAT
  R2_2: 22, // COUNT_BOUND
  R3_1: 31, // IMPL_CHAIN (reserved; never emitted — see note)
  R3_2: 32, // EQUIV_CLASS (reserved; never emitted)
  R4_1: 41, // HYPO_1
  R5_1: 51, // HYPO_2 (reserved, gated off in v1)
} as const;
export type Rule = (typeof Rule)[keyof typeof Rule];

export function tierOf(rule: number): number {
  return rule < 10 ? 0 : Math.floor(rule / 10);
}

export const RULE_NAME: Record<number, string> = {
  0: "R0 ANCHOR_PROP",
  11: "R1.1 IMPL_MP",
  12: "R1.2 IMPL_MT",
  13: "R1.3 XOR_RES",
  14: "R1.4 NAND_RES",
  15: "R1.5 OR_RES",
  16: "R1.6 EQUIV_COPY",
  21: "R2.1 COUNT_SAT",
  22: "R2.2 COUNT_BOUND",
  31: "R3.1 IMPL_CHAIN",
  32: "R3.2 EQUIV_CLASS",
  41: "R4.1 HYPO_1",
  51: "R5.1 HYPO_2",
};
