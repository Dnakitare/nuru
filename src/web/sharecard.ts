// Renders the shareable result card as a PNG. This is the growth surface — a
// feed-ready image. The DAILY card is spoiler-free (a branded emblem, not the
// answer glyph, so sharing doesn't ruin the puzzle for others); PRACTICE cards
// show the solved glyph itself.

export interface CardOpts {
  showGlyph: boolean; // true for practice (safe), false for the daily (spoiler-free)
  rows: number;
  cols: number;
  cells: Uint8Array; // the solved glyph
  label: string; // "glyph #200" or "practice"
  time: string; // "0:42"
}

const BG = "#0a0e14";
const LIT = "#6fe3c4";
const INK = "#cfd8e2";
const DIM = "#6b7787";

// a fixed decorative emblem (NOT any answer glyph) for the daily card
const EMBLEM = [
  "..#..#..",
  ".#....#.",
  "#..##..#",
  "..####..",
  "..####..",
  "#..##..#",
  ".#....#.",
  "..#..#..",
];

export function renderShareCard(opts: CardOpts): Promise<Blob> {
  const W = 720;
  const H = 900;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // background + soft top glow
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 120, 40, W / 2, 120, 620);
  g.addColorStop(0, "rgba(16,26,38,0.9)");
  g.addColorStop(1, "rgba(10,14,20,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // wordmark
  ctx.textAlign = "center";
  ctx.fillStyle = LIT;
  ctx.font = "600 30px ui-monospace, Menlo, monospace";
  ctx.save();
  ctx.translate(W / 2, 96);
  ctx.fillText("n u r u", 0, 0);
  ctx.restore();

  // the visual: solved glyph (practice) or the spoiler-free emblem (daily)
  const rows = opts.showGlyph ? opts.rows : 8;
  const cols = opts.showGlyph ? opts.cols : 8;
  const lit = (r: number, c: number): boolean =>
    opts.showGlyph ? opts.cells[r * opts.cols + c] === 1 : EMBLEM[r]![c] === "#";

  const cell = 56;
  const gap = 10;
  const gridW = cols * (cell + gap) - gap;
  const gridH = rows * (cell + gap) - gap;
  const ox = (W - gridW) / 2;
  const oy = 180;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!lit(r, c)) continue;
      const x = ox + c * (cell + gap);
      const y = oy + r * (cell + gap);
      ctx.save();
      ctx.shadowColor = LIT;
      ctx.shadowBlur = 22;
      ctx.fillStyle = LIT;
      roundRect(ctx, x, y, cell, cell, 12);
      ctx.fill();
      ctx.restore();
    }
  }

  // caption block
  const capY = oy + gridH + 96;
  ctx.fillStyle = INK;
  ctx.font = "700 46px -apple-system, system-ui, sans-serif";
  ctx.fillText(opts.showGlyph ? "revealed" : "solved", W / 2, capY);
  ctx.fillStyle = LIT;
  ctx.font = "600 40px ui-monospace, Menlo, monospace";
  ctx.fillText(opts.time, W / 2, capY + 56);
  ctx.fillStyle = DIM;
  ctx.font = "26px ui-monospace, Menlo, monospace";
  ctx.fillText(`${opts.label} · no guesses`, W / 2, capY + 104);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
