// Deterministic sigil geometry (SPEC-PRODUCT §3): a pure function of
// (puzzleDigest, difficulty.scalar). N-fold symmetry where N = threadCount
// clamped 3..8, ring count = maxTier, stroke complexity scales with scalar.
// Everyone who solves the same knot earns the same sigil; harder knots grow
// visibly more intricate — the collection is the trajectory chart.

export interface SigilSpec {
  digest: Uint8Array;
  threadCount: number;
  maxTier: number;
  scalar: number;
}

/** Build an SVG group (paths) for the sigil, drawn in a [-1,1]² space. */
export function sigilSvg(spec: SigilSpec, stroke: string): string {
  const N = Math.max(3, Math.min(8, spec.threadCount));
  const rings = Math.max(1, spec.maxTier);
  const b = spec.digest;
  const byte = (i: number) => b[i % b.length]!;
  const complexity = Math.min(6, 2 + Math.floor(spec.scalar / 3)); // vertices per spoke

  const paths: string[] = [];

  // Concentric rings, each a polygon with jittered radius from digest bytes.
  for (let r = 0; r < rings; r++) {
    const baseR = 0.32 + (r / rings) * 0.62;
    const pts: string[] = [];
    for (let k = 0; k < N; k++) {
      const jitter = (byte(r * N + k) / 255 - 0.5) * 0.12;
      const rad = baseR + jitter;
      const a = (k / N) * Math.PI * 2 - Math.PI / 2;
      pts.push(`${(Math.cos(a) * rad).toFixed(3)},${(Math.sin(a) * rad).toFixed(3)}`);
    }
    paths.push(`<polygon points="${pts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="1.3" vector-effect="non-scaling-stroke" opacity="${(0.35 + 0.5 * (r / rings)).toFixed(2)}"/>`);
  }

  // Spokes with digest-driven kinks — the "stroke complexity".
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 - Math.PI / 2;
    let d = `M 0 0`;
    for (let s = 1; s <= complexity; s++) {
      const rad = (s / complexity) * (0.92 + (byte(k * complexity + s) / 255 - 0.5) * 0.1);
      const wob = (byte(k * 7 + s * 3) / 255 - 0.5) * 0.22;
      const aa = a + wob;
      d += ` L ${(Math.cos(aa) * rad).toFixed(3)} ${(Math.sin(aa) * rad).toFixed(3)}`;
    }
    paths.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.8"/>`);
  }

  // Center node.
  paths.push(`<circle cx="0" cy="0" r="${(0.05 + (byte(3) / 255) * 0.04).toFixed(3)}" fill="${stroke}"/>`);

  return `<g>${paths.join("")}</g>`;
}
