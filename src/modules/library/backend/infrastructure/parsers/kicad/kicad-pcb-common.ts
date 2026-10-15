/**
 * Low-level `.kicad_pcb` readers shared by the board parser and its
 * footprint / graphics / outline / zone modules. Pure: no state, no defaults
 * invented beyond what each reader documents.
 */

import {
  type SExpr,
  findNode,
  getNumberValue,
  getStringValue,
} from "@openpcb/kicad-parsers";

export interface KicadPointMm {
  xMm: number;
  yMm: number;
}

/** Canonical copper layer names (`F.Cu`, `B.Cu`, `InN.Cu`) — counted by NAME, not layer type. */
export const KICAD_COPPER_LAYER_NAME = /^(F|B|In\d+)\.Cu$/;

export function readPointTagged(node: SExpr[] | null): KicadPointMm | null {
  if (!node) return null;
  const x = getNumberValue(node, 1);
  const y = getNumberValue(node, 2);
  if (x === null || y === null) return null;
  return { xMm: x, yMm: y };
}

export function readAtRotation(node: SExpr[] | null): number {
  if (!node) return 0;
  return getNumberValue(node, 3) ?? 0;
}

export function readNumberToken(
  node: SExpr[] | null,
  tag: string,
): number | null {
  if (!node) return null;
  const found = findNode(node, tag);
  if (!found) return null;
  const value = getNumberValue(found, 1);
  return value !== null && Number.isFinite(value) ? value : null;
}

/** `(tag yes|no|true|false)`; a bare `(tag)` reads as yes; absent → `null`. */
export function readYesNoToken(
  node: SExpr[] | null,
  tag: string,
): boolean | null {
  if (!node) return null;
  const found = findNode(node, tag);
  if (!found) return null;
  const value = getStringValue(found, 1);
  if (value === null) return true;
  return value === "yes" || value === "true";
}

/** Both the modern `(locked yes)` node and the legacy bare `locked` atom. */
export function readLockedFlag(node: SExpr[]): boolean {
  for (const child of node) {
    if (child === "locked") return true;
    if (Array.isArray(child) && child[0] === "locked") {
      const value = getStringValue(child, 1);
      return value === null || value === "yes" || value === "true";
    }
  }
  return false;
}

export function readUuid(node: SExpr[]): string | null {
  return (
    getStringValue(findNode(node, "uuid") ?? [], 1) ??
    getStringValue(findNode(node, "tstamp") ?? [], 1)
  );
}

/**
 * A copper item's `(net …)` reference, tolerant of all three spellings:
 * `(net N)` (KiCad ≤ 9 items — the name comes from the board net table),
 * `(net N "name")` (pads) and the name-only `(net "name")`. The sexpr reader
 * keeps quoted atoms as strings, so a net literally named `"5"` stays a name.
 * No `(net …)` token → no-net copper (`null`/`null`); the item is kept. An
 * ordinal the table does not declare keeps its ordinal with `netName: null`.
 */
export function readNetRef(
  node: SExpr[],
  netByOrdinal: ReadonlyMap<number, string>,
): { netOrdinal: number | null; netName: string | null } {
  const net = findNode(node, "net");
  if (!net) return { netOrdinal: null, netName: null };
  const first = net[1];
  if (typeof first === "number") {
    const explicit = typeof net[2] === "string" ? net[2] : null;
    return {
      netOrdinal: first,
      netName: explicit ?? netByOrdinal.get(first) ?? null,
    };
  }
  if (typeof first === "string") return { netOrdinal: null, netName: first };
  return { netOrdinal: null, netName: null };
}

/** `(layer "X" [knockout])` / `(layers "A" "B" …)` names, in file order. */
export function readLayerNames(node: SExpr[]): string[] {
  const out: string[] = [];
  const single = findNode(node, "layer");
  const singleName = single ? getStringValue(single, 1) : null;
  if (singleName) out.push(singleName);
  const multi = findNode(node, "layers");
  if (multi) {
    for (let i = 1; i < multi.length; i += 1) {
      const value = multi[i];
      if (typeof value === "string" && !out.includes(value)) out.push(value);
    }
  }
  return out;
}

export function mod2pi(theta: number): number {
  const x = theta % (2 * Math.PI);
  return x < 0 ? x + 2 * Math.PI : x;
}

/**
 * Chord points of a KiCad three-point arc (start, mid, end): the circumcircle,
 * walked through the side containing `mid`, up to `chordsPerNinety` chords per
 * 90° of sweep. Collinear points degrade to the straight chord.
 */
export function tessellateArcChords(
  start: KicadPointMm,
  mid: KicadPointMm,
  end: KicadPointMm,
  chordsPerNinety: number,
): KicadPointMm[] {
  const ax = start.xMm;
  const ay = start.yMm;
  const bx = mid.xMm;
  const by = mid.yMm;
  const cx = end.xMm;
  const cy = end.yMm;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [start, end];
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux);
  const a1 = Math.atan2(by - uy, bx - ux);
  const a2 = Math.atan2(cy - uy, cx - ux);
  const ccwToMid = mod2pi(a1 - a0);
  const ccwToEnd = mod2pi(a2 - a0);
  const goesCcw = ccwToMid <= ccwToEnd;
  const sweep = goesCcw ? ccwToEnd : 2 * Math.PI - ccwToEnd;
  const chords = Math.max(
    1,
    Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * chordsPerNinety),
  );
  const out: KicadPointMm[] = [start];
  for (let i = 1; i <= chords; i += 1) {
    const t = i / chords;
    const angle = goesCcw ? a0 + sweep * t : a0 - sweep * t;
    out.push(
      i === chords
        ? end
        : { xMm: ux + r * Math.cos(angle), yMm: uy + r * Math.sin(angle) },
    );
  }
  return out;
}
