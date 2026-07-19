// Curated library of recognizable 8×8 glyphs for the Reveal game. The engine
// builds a unique, no-guess deduction puzzle FOR the chosen glyph, so the reveal
// is an actual symbol. 8×8 (up from 6×6) gives room for crisp, readable shapes;
// row/column counts use COUNT_EQ_WIDE (registry id 9) to stay valid at arity 8.
//
// '#' = lit, '.' = dark. Each entry is exactly 8 rows × 8 columns. Add more
// freely — the daily rotation grows with the list.

type Row8 = string;
interface GlyphArt {
  name: string;
  art: [Row8, Row8, Row8, Row8, Row8, Row8, Row8, Row8];
}

const GLYPH_ART: GlyphArt[] = [
  { name: "heart", art: [".##..##.", "########", "########", "########", ".######.", "..####..", "...##...", "........"] },
  { name: "diamond", art: ["...##...", "..####..", ".######.", "########", "########", ".######.", "..####..", "...##..."] },
  { name: "circle", art: ["..####..", ".######.", "########", "########", "########", "########", ".######.", "..####.."] },
  { name: "ring", art: ["..####..", ".##..##.", "##....##", "##....##", "##....##", "##....##", ".##..##.", "..####.."] },
  { name: "plus", art: ["...##...", "...##...", "...##...", "########", "########", "...##...", "...##...", "...##..."] },
  { name: "x", art: ["##....##", "###..###", ".######.", "..####..", "..####..", ".######.", "###..###", "##....##"] },
  { name: "sparkle", art: ["...##...", "#..##..#", ".##..##.", "..####..", "..####..", ".##..##.", "#..##..#", "...##..."] },
  { name: "arrow up", art: ["...##...", "..####..", ".######.", "########", "...##...", "...##...", "...##...", "...##..."] },
  { name: "arrow down", art: ["...##...", "...##...", "...##...", "...##...", "########", ".######.", "..####..", "...##..."] },
  { name: "arrow left", art: ["...#....", "..##....", ".###....", "########", "########", ".###....", "..##....", "...#...."] },
  { name: "arrow right", art: ["....#...", "....##..", "....###.", "########", "########", "....###.", "....##..", "....#..."] },
  { name: "house", art: ["...##...", "..####..", ".######.", "########", "##....##", "##.##.##", "##.##.##", "##.##.##"] },
  { name: "tree", art: ["...##...", "..####..", ".######.", "########", ".######.", "..####..", "...##...", "...##..."] },
  { name: "key", art: ["..####..", ".##..##.", ".##..##.", "..####..", "...##...", "...##...", "...###..", "...#.#.."] },
  { name: "anchor", art: ["...##...", "..####..", "...##...", "...##...", "#..##..#", "#..##..#", "##.##.##", ".######."] },
  { name: "moon", art: ["..####..", ".###....", "###.....", "###.....", "###.....", "###.....", ".###....", "..####.."] },
  { name: "sun", art: ["...##...", "#..##..#", ".######.", "########", "########", ".######.", "#..##..#", "...##..."] },
  { name: "flag", art: ["########", "##....##", "##.##.##", "########", "##......", "##......", "##......", "##......"] },
  { name: "crown", art: ["#..##..#", "##.##.##", "########", "########", "########", "########", "########", "........"] },
  { name: "cat", art: ["##....##", "###..###", "########", "########", "#.####.#", "########", "#.#..#.#", ".######."] },
  { name: "ghost", art: ["..####..", ".######.", "########", "##.##.##", "########", "########", "########", "#.#..#.#"] },
  { name: "skull", art: [".######.", "########", "##.##.##", "########", ".######.", "##.##.##", ".######.", "..#..#.."] },
  { name: "hourglass", art: ["########", "########", ".######.", "..####..", "..####..", ".######.", "########", "########"] },
  { name: "bowtie", art: ["##....##", "###..###", ".######.", "..####..", "..####..", ".######.", "###..###", "##....##"] },
  { name: "triangle", art: ["...##...", "...##...", "..####..", "..####..", ".######.", ".######.", "########", "########"] },
  { name: "spade", art: ["...##...", "..####..", ".######.", "########", "########", "##.##.##", "...##...", "..####.."] },
  { name: "drop", art: ["...##...", "...##...", "..####..", ".######.", "########", "########", "########", ".######."] },
  { name: "mushroom", art: ["..####..", ".######.", "########", "########", "...##...", "...##...", "...##...", "..####.."] },
  { name: "bell", art: ["...##...", "..####..", ".######.", ".######.", "########", "########", "########", "...##..."] },
  { name: "hash", art: ["..#..#..", "..#..#..", "########", "..#..#..", "..#..#..", "########", "..#..#..", "..#..#.."] },
  { name: "eye", art: ["........", "..####..", ".##..##.", "##.##.##", "##.##.##", ".##..##.", "..####..", "........"] },
  { name: "letter a", art: ["...##...", "..####..", ".##..##.", "##....##", "########", "########", "##....##", "##....##"] },
  { name: "letter h", art: ["##....##", "##....##", "##....##", "########", "########", "##....##", "##....##", "##....##"] },
  { name: "letter t", art: ["########", "########", "...##...", "...##...", "...##...", "...##...", "...##...", "...##..."] },
  { name: "letter s", art: [".######.", "##....##", "##......", ".######.", "......##", "##....##", "##....##", ".######."] },
  { name: "letter e", art: ["########", "########", "##......", "######..", "######..", "##......", "########", "########"] },
  { name: "letter k", art: ["##....##", "##...##.", "##..##..", "####....", "####....", "##..##..", "##...##.", "##....##"] },
  { name: "letter z", art: ["########", "########", ".....##.", "...##...", "..##....", "##......", "########", "########"] },
];

export interface Glyph {
  name: string;
  rows: number;
  cols: number;
  cells: Uint8Array; // row-major, 1 = lit
}

export const GLYPHS: Glyph[] = GLYPH_ART.map(({ name, art }) => {
  const rows = art.length;
  const cols = art[0].length;
  const cells = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[r * cols + c] = art[r]![c] === "#" ? 1 : 0;
  return { name, rows, cols, cells };
});

// Difficulty tiers, MEASURED not hand-guessed: each glyph's board is generated
// across 24 seeds and tiered by the relational-deduction load it needs — the
// median count of = / ≠ links (plus heavily-weighted pre-lit givens). tier 0
// solves from row/column counts alone (no relational reasoning, picross-easy);
// tier 1/2 need increasing link deduction. Cuts: 0 links = easy, 1–9 = medium,
// 10+ = hard. Regenerate the split with `npx tsx measure-tiers.mts`.
// NOTE: this is measured difficulty, not human-anchored — the §4.2 Spearman
// gate (measured vs. real solve-time) still needs a human solving by hand.
const MEDIUM = new Set(["heart", "spade", "letter z", "anchor", "sun", "ghost", "skull"]);
const HARD = new Set(["house", "cat", "key", "moon", "letter s", "letter k", "eye", "letter a", "sparkle", "x", "bowtie", "ring"]);

export function glyphTier(name: string): 0 | 1 | 2 {
  return HARD.has(name) ? 2 : MEDIUM.has(name) ? 1 : 0;
}

/** Glyph indices grouped by difficulty tier. */
export const REVEAL_TIERS: { easy: number[]; medium: number[]; hard: number[] } = { easy: [], medium: [], hard: [] };
GLYPHS.forEach((g, i) => {
  const t = glyphTier(g.name);
  (t === 2 ? REVEAL_TIERS.hard : t === 1 ? REVEAL_TIERS.medium : REVEAL_TIERS.easy).push(i);
});
