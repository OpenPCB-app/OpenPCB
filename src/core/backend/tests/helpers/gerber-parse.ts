/**
 * Read an emitted Gerber X2 layer back: its aperture table (`%AM` macros +
 * `%ADD` definitions) and every `D03` flash with the aperture that was current
 * when it fired. Used by the export-parity harness (manufacturability contract
 * 10 §6.5) and by the B6-1 audit test, so both judge the artwork by PARSING it
 * rather than by trusting the writer's own helpers.
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

export interface ParsedGerber {
  apertures: Map<number, GerberAperture>;
  flashes: GerberFlash[];
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
  let pendingFunction: string | null = null;
  let current = -1;
  let inRegion = false;

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
    if (line === "G36*") inRegion = true;
    else if (line === "G37*") inRegion = false;
    const dcode = /^D(\d+)\*$/.exec(line);
    if (dcode) {
      const code = Number(dcode[1]);
      if (code >= 10) current = code;
      continue;
    }
    const flash = /^X(-?\d+)Y(-?\d+)D03\*$/.exec(line);
    if (flash && !inRegion) {
      flashes.push({
        code: current,
        xMm: Number(flash[1]) / COORD_SCALE,
        yMm: Number(flash[2]) / COORD_SCALE,
      });
    }
  }
  return { apertures, flashes };
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
