// A compact seeded force-directed layout for the knot inspector. This lives in
// the web layer only — real layout (with the §5 legibility budget) is a Phase 2
// engine concern; this is just enough to draw a legible knot for review.

import type { Constraint } from "../core/types.js";
import { CType } from "../core/types.js";

export interface Pt {
  x: number;
  y: number;
}

function seededRand(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    a >>>= 0;
    return a / 0xffffffff;
  };
}

/** Adjacency edges from constraints: binaries as-is, counts as a star to the first thread. */
export function edgesOf(constraints: readonly Constraint[]): [number, number][] {
  const edges: [number, number][] = [];
  for (const c of constraints) {
    if (c.type === CType.ANCHOR) continue;
    const ts = c.threads;
    if (ts.length === 2) edges.push([ts[0]!, ts[1]!]);
    else for (let i = 1; i < ts.length; i++) edges.push([ts[0]!, ts[i]!]);
  }
  return edges;
}

/** Positions in [0,1]² after a short force relaxation. Deterministic per seed. */
export function layout(n: number, constraints: readonly Constraint[], seed: number): Pt[] {
  const rand = seededRand(seed || 1);
  const pos: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos.push({ x: Math.cos(a) * 0.35 + 0.5 + (rand() - 0.5) * 0.05, y: Math.sin(a) * 0.35 + 0.5 + (rand() - 0.5) * 0.05 });
  }
  const edges = edgesOf(constraints);
  const kRep = 0.0016;
  const rest = 0.26;
  const kAtt = 0.06;

  for (let iter = 0; iter < 320; iter++) {
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i]!.x - pos[j]!.x;
        let dy = pos[i]!.y - pos[j]!.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-5) {
          dx = (rand() - 0.5) * 0.01;
          dy = (rand() - 0.5) * 0.01;
          d2 = dx * dx + dy * dy + 1e-5;
        }
        const f = kRep / d2;
        const d = Math.sqrt(d2);
        fx[i] = fx[i]! + (dx / d) * f;
        fy[i] = fy[i]! + (dy / d) * f;
        fx[j] = fx[j]! - (dx / d) * f;
        fy[j] = fy[j]! - (dy / d) * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = pos[b]!.x - pos[a]!.x;
      const dy = pos[b]!.y - pos[a]!.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
      const f = kAtt * (d - rest);
      fx[a] = fx[a]! + (dx / d) * f;
      fy[a] = fy[a]! + (dy / d) * f;
      fx[b] = fx[b]! - (dx / d) * f;
      fy[b] = fy[b]! - (dy / d) * f;
    }
    const damp = 0.85;
    for (let i = 0; i < n; i++) {
      pos[i]!.x += fx[i]! * damp;
      pos[i]!.y += fy[i]! * damp;
      // gentle gravity toward center
      pos[i]!.x += (0.5 - pos[i]!.x) * 0.008;
      pos[i]!.y += (0.5 - pos[i]!.y) * 0.008;
    }
  }

  // Normalize to [0,1] with padding.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pos) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1e-3);
  const h = Math.max(maxY - minY, 1e-3);
  const pad = 0.12;
  return pos.map((p) => ({
    x: pad + ((p.x - minX) / w) * (1 - 2 * pad),
    y: pad + ((p.y - minY) / h) * (1 - 2 * pad),
  }));
}
