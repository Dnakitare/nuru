// xoshiro128** — the single seeded PRNG all generation randomness flows from
// (SPEC-GENERATOR §1). Deterministic and portable: the same seed yields the
// same puzzle in Node and browser, which is what makes daily-puzzle scheduling
// and bug-report reproduction work.

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    const sm = splitmix32(seed >>> 0);
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
  }

  /** Next unsigned 32-bit integer. */
  u32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7) >>> 0, 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result >>> 0;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.u32() / 0x100000000;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  bool(pTrue = 0.5): boolean {
    return this.float() < pTrue;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }

  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Pick an index from a weight array proportional to weights (weights ≥ 0). */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

/** Derive an independent sub-seed for attempt `i` from a base seed. */
export function mixSeed(base: number, i: number): number {
  let z = (base ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}
