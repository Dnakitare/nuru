// A curated library of recognizable 6×6 glyphs for the Reveal game. The engine
// builds a unique, no-guess deduction puzzle FOR the chosen glyph, so the reveal
// is an actual symbol ("oh, it's a heart") rather than random noise. Easily
// extended — add rows to GLYPH_ART and the daily rotation grows.
//
// '#' = lit, '.' = dark. Each entry is exactly 6 rows × 6 columns.

interface GlyphArt {
  name: string;
  art: [string, string, string, string, string, string];
}

const GLYPH_ART: GlyphArt[] = [
  { name: "heart", art: [".#..#.", "######", "######", "######", ".####.", "..##.."] },
  { name: "diamond", art: ["..##..", ".####.", "######", "######", ".####.", "..##.."] },
  { name: "plus", art: ["..##..", "..##..", "######", "######", "..##..", "..##.."] },
  { name: "cross", art: ["#....#", ".#..#.", "..##..", "..##..", ".#..#.", "#....#"] },
  { name: "ring", art: [".####.", "#....#", "#....#", "#....#", "#....#", ".####."] },
  { name: "frame", art: ["######", "#....#", "#....#", "#....#", "#....#", "######"] },
  { name: "arrow up", art: ["..##..", ".####.", "######", "..##..", "..##..", "..##.."] },
  { name: "arrow down", art: ["..##..", "..##..", "..##..", "######", ".####.", "..##.."] },
  { name: "tree", art: ["..##..", ".####.", "######", ".####.", "..##..", "..##.."] },
  { name: "house", art: ["..##..", ".####.", "######", "######", ".#..#.", ".#..#."] },
  { name: "hourglass", art: ["######", ".####.", "..##..", "..##..", ".####.", "######"] },
  { name: "bowtie", art: ["#....#", "##..##", ".####.", ".####.", "##..##", "#....#"] },
  { name: "letter h", art: ["##..##", "##..##", "######", "######", "##..##", "##..##"] },
  { name: "letter t", art: ["######", "######", "..##..", "..##..", "..##..", "..##.."] },
  { name: "letter a", art: ["..##..", ".####.", "##..##", "######", "##..##", "##..##"] },
  { name: "letter i", art: ["######", "..##..", "..##..", "..##..", "..##..", "######"] },
  { name: "letter u", art: ["##..##", "##..##", "##..##", "##..##", "######", ".####."] },
  { name: "triangle", art: ["..##..", "..##..", ".####.", ".####.", "######", "######"] },
  { name: "wedge", art: ["######", "######", ".####.", ".####.", "..##..", "..##.."] },
  { name: "spade", art: ["..##..", ".####.", "######", "######", "#.##.#", "..##.."] },
  { name: "star", art: ["..##..", "#.##.#", "######", "######", "#.##.#", "..##.."] },
  { name: "drop", art: ["..##..", "..##..", ".####.", "######", "######", ".####."] },
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
