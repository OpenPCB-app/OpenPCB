/**
 * Read an emitted Gerber X2 layer back: its aperture table (`%AM` macros +
 * `%ADD` definitions) and every `D03` flash with the aperture that was current
 * when it fired. Used by the export-parity harness (manufacturability contract
 * 10 §6.5) and by the B6-1 audit test, so both judge the artwork by PARSING it
 * rather than by trusting the writer's own helpers.
 *
 * S12 adds STROKE and REGION capture (DFM contract 11 §1.5): a `D02` starts a
 * stroke and the following `D01`s extend it with the aperture that was current,
 * and every `G36 … G37` contour is captured with its polarity — so the silk
 * parity harness can compare the emitted legend to the artwork model 1:1.
 *
 * Every aperture — standard or macro — is reduced to a union of CONVEX
 * primitives (axis-aligned-then-rotated rectangles and circles), which is
 * exactly what an aperture macro is and what a `C` / `R` / `O` aperture can be
 * written as. Membership in a union of convex sets is exact (`p` is inside iff
 * some primitive contains it), which is what the parity comparison needs.
 */

export interface RectPrimitive {
  kind: "rect";
  widthMm: number;
  heightMm: number;
  /** Centre in the aperture frame, AFTER the primitive's own rotation. */
  cxMm: number;
  cyMm: number;
  /** CCW degrees the rectangle's own axes are turned by. */
  rotationDeg: number;
}

export interface CirclePrimitive {
  kind: "circle";
  diameterMm: number;
  cxMm: number;
  cyMm: number;
}

export type GerberPrimitive = RectPrimitive | CirclePrimitive;

export interface GerberAperture {
  code: number;
  /** The `%TA.AperFunction,…*%` that preceded the definition, if any. */
  aperFunction: string | null;
  /** Verbatim `%ADD…*%` line, for diagnostics. */
  definition: string;
  primitives: GerberPrimitive[];
}

export interface GerberFlash {
  code: number;
  xMm: number;
  yMm: number;
}

export interface GerberPoint {
  xMm: number;
  yMm: number;
}

/** One `D02` move plus the `D01` draws that followed it, outside any region. */
export interface GerberStroke {
  apertureCode: number;
  points: GerberPoint[];
}

/** One `G36 … G37` contour, with the polarity in force when it was emitted. */
export interface GerberRegion {
  polarity: "dark" | "clear";
  points: GerberPoint[];
}

export interface ParsedGerber {
  apertures: Map<number, GerberAperture>;
  flashes: GerberFlash[];
  strokes: GerberStroke[];
  regions: GerberRegion[];
}

const COORD_SCALE = 1_000_000;

function rotate(x: number, y: number, deg: number): [number, number] {
  if (deg === 0) return [x, y];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

/** `O,wXh` — a stadium as its straight body plus the two round caps. */
function obroundPrimitives(w: number, h: number): GerberPrimitive[] {
  const tool = Math.min(w, h);
  const span = Math.max(w, h) - tool;
  if (!(span > 0)) {
    return [{ kind: "circle", diameterMm: tool, cxMm: 0, cyMm: 0 }];
  }
  const half = span / 2;
  const body: RectPrimitive =
    w > h
      ? {
          kind: "rect",
          widthMm: span,
          heightMm: h,
          cxMm: 0,
          cyMm: 0,
          rotationDeg: 0,
        }
      : {
          kind: "rect",
          widthMm: w,
          heightMm: span,
          cxMm: 0,
          cyMm: 0,
          rotationDeg: 0,
        };
  const caps: CirclePrimitive[] =
    w > h
      ? [
          { kind: "circle", diameterMm: tool, cxMm: -half, cyMm: 0 },
          { kind: "circle", diameterMm: tool, cxMm: half, cyMm: 0 },
        ]
      : [
          { kind: "circle", diameterMm: tool, cxMm: 0, cyMm: -half },
          { kind: "circle", diameterMm: tool, cxMm: 0, cyMm: half },
        ];
  return [body, ...caps];
}

/** One macro body (`%AM<name>*` … `%`) → its primitives. */
function parseMacroBody(lines: readonly string[]): GerberPrimitive[] {
  const out: GerberPrimitive[] = [];
  for (const line of lines) {
    const body = line.replace(/\*$/, "");
    if (body.length === 0 || body.startsWith("0 ")) continue;
    const parts = body.split(",").map((v) => Number(v));
    if (parts.some((v) => !Number.isFinite(v))) {
      throw new Error(`unsupported macro primitive: ${line}`);
    }
    const code = parts[0];
    if (code === 21) {
      // 21,exposure,width,height,cx,cy,rotation
      const [, exposure, w, h, cx, cy, rot = 0] = parts as number[];
      if (exposure !== 1) throw new Error(`clear macro primitive: ${line}`);
      const [rx, ry] = rotate(cx!, cy!, rot!);
      out.push({
        kind: "rect",
        widthMm: w!,
        heightMm: h!,
        cxMm: rx,
        cyMm: ry,
        rotationDeg: rot!,
      });
    } else if (code === 1) {
      // 1,exposure,diameter,cx,cy[,rotation]
      const [, exposure, d, cx, cy, rot = 0] = parts as number[];
      if (exposure !== 1) throw new Error(`clear macro primitive: ${line}`);
      const [rx, ry] = rotate(cx!, cy!, rot!);
      out.push({ kind: "circle", diameterMm: d!, cxMm: rx, cyMm: ry });
    } else {
      throw new Error(`unsupported macro primitive code ${code}: ${line}`);
    }
  }
  return out;
}

export function parseGerber(text: string): ParsedGerber {
  const lines = text.split("\r\n");
  const macros = new Map<string, GerberPrimitive[]>();
  const apertures = new Map<number, GerberAperture>();
  const flashes: GerberFlash[] = [];
  const strokes: GerberStroke[] = [];
  const regions: GerberRegion[] = [];
  let pendingFunction: string | null = null;
  let current = -1;
  let inRegion = false;
  let polarity: "dark" | "clear" = "dark";
  let openStroke: GerberStroke | null = null;
  let openRegion: GerberPoint[] | null = null;

  // A stroke with a single `D02` and no `D01` draws nothing; drop it rather
  // than report a phantom stroke the artwork model can never match.
  const flushStroke = (): void => {
    if (openStroke && openStroke.points.length >= 2) strokes.push(openStroke);
    openStroke = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith("%AM")) {
      const name = line.slice(3).replace(/\*$/, "");
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && lines[j] !== "%"; j += 1) body.push(lines[j]!);
      macros.set(name, parseMacroBody(body));
      i = j;
      continue;
    }
    const attr = /^%TA\.AperFunction,(.*)\*%$/.exec(line);
    if (attr) {
      pendingFunction = attr[1]!;
      continue;
    }
    const add = /^%ADD(\d+)(.*)\*%$/.exec(line);
    if (add) {
      const code = Number(add[1]);
      const spec = add[2]!;
      apertures.set(code, {
        code,
        aperFunction: pendingFunction,
        definition: line,
        primitives: primitivesOfSpec(spec, macros),
      });
      pendingFunction = null;
      continue;
    }
    if (line === "%LPD*%") polarity = "dark";
    else if (line === "%LPC*%") polarity = "clear";
    if (line === "G36*") {
      flushStroke();
      inRegion = true;
      openRegion = [];
      continue;
    }
    if (line === "G37*") {
      if (openRegion) regions.push({ polarity, points: openRegion });
      openRegion = null;
      inRegion = false;
      continue;
    }
    const dcode = /^D(\d+)\*$/.exec(line);
    if (dcode) {
      const code = Number(dcode[1]);
      if (code >= 10) {
        flushStroke();
        current = code;
      }
      continue;
    }
    const op = /^X(-?\d+)Y(-?\d+)D0([123])\*$/.exec(line);
    if (!op) continue;
    const point: GerberPoint = {
      xMm: Number(op[1]) / COORD_SCALE,
      yMm: Number(op[2]) / COORD_SCALE,
    };
    if (inRegion) {
      openRegion?.push(point);
      continue;
    }
    switch (op[3]) {
      case "1":
        openStroke?.points.push(point);
        break;
      case "2":
        flushStroke();
        openStroke = { apertureCode: current, points: [point] };
        break;
      default:
        flushStroke();
        flashes.push({ code: current, xMm: point.xMm, yMm: point.yMm });
    }
  }
  flushStroke();
  return { apertures, flashes, strokes, regions };
}

function primitivesOfSpec(
  spec: string,
  macros: ReadonlyMap<string, GerberPrimitive[]>,
): GerberPrimitive[] {
  const circle = /^C,([\d.]+)$/.exec(spec);
  if (circle) {
    return [
      { kind: "circle", diameterMm: Number(circle[1]), cxMm: 0, cyMm: 0 },
    ];
  }
  const rect = /^R,([\d.]+)X([\d.]+)$/.exec(spec);
  if (rect) {
    return [
      {
        kind: "rect",
        widthMm: Number(rect[1]),
        heightMm: Number(rect[2]),
        cxMm: 0,
        cyMm: 0,
        rotationDeg: 0,
      },
    ];
  }
  const obround = /^O,([\d.]+)X([\d.]+)$/.exec(spec);
  if (obround) {
    return obroundPrimitives(Number(obround[1]), Number(obround[2]));
  }
  const macro = macros.get(spec);
  if (!macro) throw new Error(`unknown aperture spec: ${spec}`);
  return macro;
}

/**
 * Is `p` (aperture-frame mm, relative to the flash point) covered by the
 * aperture? A union of convex primitives, so membership is exact.
 */
export function insidePrimitives(
  primitives: readonly GerberPrimitive[],
  px: number,
  py: number,
): boolean {
  for (const prim of primitives) {
    if (prim.kind === "circle") {
      const dx = px - prim.cxMm;
      const dy = py - prim.cyMm;
      if (Math.hypot(dx, dy) <= prim.diameterMm / 2) return true;
      continue;
    }
    const [lx, ly] = rotate(px - prim.cxMm, py - prim.cyMm, -prim.rotationDeg);
    if (Math.abs(lx) <= prim.widthMm / 2 && Math.abs(ly) <= prim.heightMm / 2) {
      return true;
    }
  }
  return false;
}
