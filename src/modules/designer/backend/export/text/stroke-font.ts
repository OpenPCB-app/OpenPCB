/**
 * Compact single-stroke (monospace) vector font for silkscreen text export.
 *
 * PCB silk is conventionally drawn with a single-stroke font (KiCad ships one).
 * Glyphs live on an integer grid: x ∈ [0, 4], baseline y = 0, cap height y = 6,
 * descenders to y = -2. Each glyph is a list of polyline strokes (pen-down
 * runs). Advance is uniform (`GLYPH_ADVANCE`) — monospace, which matches how
 * fab silk is rendered and keeps layout trivial.
 *
 * Lowercase letters with no dedicated glyph fall back to small-caps (the
 * uppercase glyph scaled to ~0.72 cap height) — legible on silk and avoids a
 * second 26-glyph table. Unknown printable characters render as a box so a
 * missing glyph is visible rather than silently dropped.
 */

export type FontStroke = ReadonlyArray<readonly [number, number]>;
export type Glyph = ReadonlyArray<FontStroke>;

export const GLYPH_CAP_HEIGHT = 6;
export const GLYPH_ADVANCE = 6;
const SMALL_CAPS_SCALE = 0.72;

const GLYPHS: Readonly<Record<string, Glyph>> = {
  " ": [],
  "0": [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
      [0, 1],
      [1, 0],
    ],
  ],
  "1": [
    [
      [1, 4],
      [2, 6],
      [2, 0],
    ],
    [
      [0, 0],
      [4, 0],
    ],
  ],
  "2": [
    [
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
      [4, 4],
      [0, 0],
      [4, 0],
    ],
  ],
  "3": [
    [
      [0, 6],
      [4, 6],
      [2, 3],
    ],
    [
      [2, 3],
      [4, 2],
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
    ],
  ],
  "4": [
    [
      [3, 0],
      [3, 6],
      [0, 2],
      [4, 2],
    ],
  ],
  "5": [
    [
      [4, 6],
      [0, 6],
      [0, 3],
      [3, 3],
      [4, 2],
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
    ],
  ],
  "6": [
    [
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [1, 3],
      [0, 2],
    ],
  ],
  "7": [
    [
      [0, 6],
      [4, 6],
      [1, 0],
    ],
  ],
  "8": [
    [
      [1, 3],
      [0, 4],
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
      [4, 4],
      [3, 3],
      [1, 3],
      [0, 2],
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
    ],
  ],
  "9": [
    [
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
      [0, 4],
      [1, 3],
      [3, 3],
      [4, 4],
    ],
  ],
  A: [
    [
      [0, 0],
      [2, 6],
      [4, 0],
    ],
    [
      [1, 2],
      [3, 2],
    ],
  ],
  B: [
    [
      [0, 0],
      [0, 6],
      [3, 6],
      [4, 5],
      [4, 4],
      [3, 3],
      [0, 3],
    ],
    [
      [3, 3],
      [4, 2],
      [4, 1],
      [3, 0],
      [0, 0],
    ],
  ],
  C: [
    [
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
    ],
  ],
  D: [
    [
      [0, 0],
      [0, 6],
      [3, 6],
      [4, 5],
      [4, 1],
      [3, 0],
      [0, 0],
    ],
  ],
  E: [
    [
      [4, 6],
      [0, 6],
      [0, 0],
      [4, 0],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ],
  F: [
    [
      [4, 6],
      [0, 6],
      [0, 0],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ],
  G: [
    [
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 3],
      [2, 3],
    ],
  ],
  H: [
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 0],
      [4, 6],
    ],
    [
      [0, 3],
      [4, 3],
    ],
  ],
  I: [
    [
      [0, 6],
      [4, 6],
    ],
    [
      [2, 6],
      [2, 0],
    ],
    [
      [0, 0],
      [4, 0],
    ],
  ],
  J: [
    [
      [4, 6],
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
    ],
  ],
  K: [
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 6],
      [0, 3],
      [4, 0],
    ],
  ],
  L: [
    [
      [0, 6],
      [0, 0],
      [4, 0],
    ],
  ],
  M: [
    [
      [0, 0],
      [0, 6],
      [2, 3],
      [4, 6],
      [4, 0],
    ],
  ],
  N: [
    [
      [0, 0],
      [0, 6],
      [4, 0],
      [4, 6],
    ],
  ],
  O: [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
      [0, 1],
      [1, 0],
    ],
  ],
  P: [
    [
      [0, 0],
      [0, 6],
      [3, 6],
      [4, 5],
      [4, 4],
      [3, 3],
      [0, 3],
    ],
  ],
  Q: [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
      [0, 1],
      [1, 0],
    ],
    [
      [2, 2],
      [4, -1],
    ],
  ],
  R: [
    [
      [0, 0],
      [0, 6],
      [3, 6],
      [4, 5],
      [4, 4],
      [3, 3],
      [0, 3],
    ],
    [
      [2, 3],
      [4, 0],
    ],
  ],
  S: [
    [
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
      [0, 4],
      [1, 3],
      [3, 3],
      [4, 2],
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
    ],
  ],
  T: [
    [
      [0, 6],
      [4, 6],
    ],
    [
      [2, 6],
      [2, 0],
    ],
  ],
  U: [
    [
      [0, 6],
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 6],
    ],
  ],
  V: [
    [
      [0, 6],
      [2, 0],
      [4, 6],
    ],
  ],
  W: [
    [
      [0, 6],
      [1, 0],
      [2, 3],
      [3, 0],
      [4, 6],
    ],
  ],
  X: [
    [
      [0, 0],
      [4, 6],
    ],
    [
      [0, 6],
      [4, 0],
    ],
  ],
  Y: [
    [
      [0, 6],
      [2, 3],
      [4, 6],
    ],
    [
      [2, 3],
      [2, 0],
    ],
  ],
  Z: [
    [
      [0, 6],
      [4, 6],
      [0, 0],
      [4, 0],
    ],
  ],
  ".": [
    [
      [1, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 0],
    ],
  ],
  ",": [
    [
      [2, 1],
      [2, 0],
      [1, -1],
    ],
  ],
  "-": [
    [
      [1, 3],
      [3, 3],
    ],
  ],
  _: [
    [
      [0, 0],
      [4, 0],
    ],
  ],
  "+": [
    [
      [2, 1],
      [2, 5],
    ],
    [
      [0, 3],
      [4, 3],
    ],
  ],
  "=": [
    [
      [0, 2],
      [4, 2],
    ],
    [
      [0, 4],
      [4, 4],
    ],
  ],
  "/": [
    [
      [0, 0],
      [4, 6],
    ],
  ],
  "\\": [
    [
      [0, 6],
      [4, 0],
    ],
  ],
  ":": [
    [
      [2, 1],
      [2, 2],
    ],
    [
      [2, 4],
      [2, 5],
    ],
  ],
  ";": [
    [
      [2, 4],
      [2, 5],
    ],
    [
      [2, 2],
      [2, 1],
      [1, 0],
    ],
  ],
  "(": [
    [
      [3, 6],
      [1, 4],
      [1, 2],
      [3, 0],
    ],
  ],
  ")": [
    [
      [1, 6],
      [3, 4],
      [3, 2],
      [1, 0],
    ],
  ],
  "[": [
    [
      [3, 6],
      [1, 6],
      [1, 0],
      [3, 0],
    ],
  ],
  "]": [
    [
      [1, 6],
      [3, 6],
      [3, 0],
      [1, 0],
    ],
  ],
  "*": [
    [
      [2, 2],
      [2, 6],
    ],
    [
      [0, 3],
      [4, 5],
    ],
    [
      [4, 3],
      [0, 5],
    ],
  ],
  "#": [
    [
      [1, 0],
      [1, 6],
    ],
    [
      [3, 0],
      [3, 6],
    ],
    [
      [0, 2],
      [4, 2],
    ],
    [
      [0, 4],
      [4, 4],
    ],
  ],
  "%": [
    [
      [0, 6],
      [4, 0],
    ],
    [
      [0, 4],
      [1, 4],
      [1, 5],
      [0, 5],
      [0, 4],
    ],
    [
      [3, 1],
      [4, 1],
      [4, 2],
      [3, 2],
      [3, 1],
    ],
  ],
  "<": [
    [
      [4, 6],
      [0, 3],
      [4, 0],
    ],
  ],
  ">": [
    [
      [0, 6],
      [4, 3],
      [0, 0],
    ],
  ],
  "!": [
    [
      [2, 6],
      [2, 2],
    ],
    [
      [2, 1],
      [2, 0],
    ],
  ],
  "?": [
    [
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
      [4, 4],
      [2, 3],
      [2, 2],
    ],
    [
      [2, 1],
      [2, 0],
    ],
  ],
  "'": [
    [
      [2, 6],
      [2, 4],
    ],
  ],
  '"': [
    [
      [1, 6],
      [1, 4],
    ],
    [
      [3, 6],
      [3, 4],
    ],
  ],
  "°": [
    [
      [1, 5],
      [2, 5],
      [2, 6],
      [1, 6],
      [1, 5],
    ],
  ],
  // µ (micro): left stem with descender tail + u-bowl.
  µ: [
    [
      [0, 4],
      [0, -2],
    ],
    [
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 4],
    ],
  ],
  // Ω (ohm): horseshoe with feet.
  Ω: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 2],
      [0, 4],
      [1, 5],
      [3, 5],
      [4, 4],
      [4, 2],
      [3, 1],
      [3, 0],
      [4, 0],
    ],
  ],
};

const TOFU: Glyph = [
  [
    [0, 0],
    [4, 0],
    [4, 6],
    [0, 6],
    [0, 0],
  ],
];

function scaleGlyphY(glyph: Glyph, factor: number): Glyph {
  return glyph.map((stroke) =>
    stroke.map(([x, y]) => [x, y * factor] as const),
  );
}

/** Resolve a character to its stroke glyph (small-caps for un-tabled lowercase). */
function glyphFor(ch: string): Glyph {
  const direct = GLYPHS[ch];
  if (direct) return direct;
  if (ch >= "a" && ch <= "z") {
    const upper = GLYPHS[ch.toUpperCase()];
    if (upper) return scaleGlyphY(upper, SMALL_CAPS_SCALE);
  }
  return TOFU;
}

export interface TextStrokeOptions {
  /** Anchor point (mm): horizontal per `justify`, vertical = text middle. */
  originMm: { x: number; y: number };
  /** Cap height (mm). */
  sizeMm: number;
  rotationDeg: number;
  /** Mirror across the anchor's vertical axis (bottom-side silk). */
  mirror: boolean;
  justify: "left" | "center" | "right";
}

/**
 * Vectorize `text` into board-space polylines (mm). Matches the canvas anchor
 * convention (`anchorX = justify`, `anchorY = middle`), then applies rotation
 * and mirror about the anchor.
 */
export function textToStrokes(
  text: string,
  opts: TextStrokeOptions,
): Array<Array<{ x: number; y: number }>> {
  const scale = opts.sizeMm / GLYPH_CAP_HEIGHT;
  const totalUnits = text.length * GLYPH_ADVANCE;
  const startX =
    opts.justify === "center"
      ? -totalUnits / 2
      : opts.justify === "right"
        ? -totalUnits
        : 0;
  // Centre the cap box [0,6] on the anchor's y.
  const yShift = -GLYPH_CAP_HEIGHT / 2;
  const rad = (opts.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const mx = opts.mirror ? -1 : 1;

  const out: Array<Array<{ x: number; y: number }>> = [];
  let penX = startX;
  for (const ch of text) {
    for (const stroke of glyphFor(ch)) {
      if (stroke.length < 2) continue;
      const poly = stroke.map(([gx, gy]) => {
        const lx = mx * (penX + gx) * scale;
        const ly = (gy + yShift) * scale;
        return {
          x: opts.originMm.x + (lx * cos - ly * sin),
          y: opts.originMm.y + (lx * sin + ly * cos),
        };
      });
      out.push(poly);
    }
    penX += GLYPH_ADVANCE;
  }
  return out;
}
