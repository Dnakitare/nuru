// TEMP: measure each glyph's real deduction difficulty by generating its board
// across many seeds and recording links + givens needed. Replaces hand-assigned
// name tiers with measured tertiles. Delete after baking results into glyphs.ts.
import { GLYPHS } from "./src/gen/glyphs.js";
import { genReveal } from "./src/gen/reveal.js";

const SEEDS = 24;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };

type Row = { name: string; links: number; givens: number; score: number };
const rows: Row[] = GLYPHS.map((g, i) => {
  const L: number[] = [], G: number[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    const b = genReveal((s * 2654435761) >>> 0, { rows: 8, cols: 8 }, [i]);
    L.push(b.links.length);
    G.push(b.givens.length);
  }
  const links = median(L), givens = median(G);
  // givens (pre-lit cells) are a strong difficulty signal — they mean the glyph
  // couldn't be pinned by relations alone. Weight them heavily.
  return { name: g.name, links, givens, score: links + givens * 4 };
});

rows.sort((a, b) => a.score - b.score);
const scores = rows.map((r) => r.score).sort((a, b) => a - b);
const t1 = scores[Math.floor(scores.length / 3)]!;
const t2 = scores[Math.floor((2 * scores.length) / 3)]!;
const tier = (s: number) => (s >= t2 ? 2 : s >= t1 ? 1 : 0);

console.log(`seeds=${SEEDS}  tertile cuts: t1(easy<${t1}) t2(hard>=${t2})\n`);
console.log("score  links givens tier  name");
for (const r of rows) console.log(`${String(r.score).padStart(4)}   ${String(r.links).padStart(4)} ${String(r.givens).padStart(5)}   ${["easy", "med", "HARD"][tier(r.score)]!.padEnd(4)}  ${r.name}`);

const byTier: Record<0 | 1 | 2, string[]> = { 0: [], 1: [], 2: [] };
for (const r of rows) byTier[tier(r.score)].push(r.name);
console.log("\nEASY:", JSON.stringify(byTier[0]));
console.log("MED :", JSON.stringify(byTier[1]));
console.log("HARD:", JSON.stringify(byTier[2]));
