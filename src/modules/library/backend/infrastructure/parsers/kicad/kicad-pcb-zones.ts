/**
 * Copper zones and KiCad rule areas (`(zone …)`) of a `.kicad_pcb` — S3a
 * contract §8. Split out of `kicad-pcb-parser.ts` unchanged except for the
 * name-only `(net "name")` spelling (H14 S2).
 */

import {
  type SExpr,
  findNode,
  findNodes,
  getNumberValue,
  getStringValue,
} from "@openpcb/kicad-parsers";
import type {
  PcbBoardContour,
  PcbOutlineSegment,
  PcbPointMm,
} from "../../../../../../sdks/designer";
import {
  type OutlineBias,
  computeOutlineBboxMm,
  flattenOutline,
} from "../../../../../../shared/pcb-geometry/outline-geometry";
import { ringStrictlyInside } from "../../../../../../shared/pcb-geometry/region-rings";
import { canonicalizeRing } from "../../../../../../shared/pcb-geometry/ring-utils";
import {
  mod2pi,
  readLockedFlag,
  readNumberToken,
  readPointTagged,
} from "./kicad-pcb-common";
import type { ParsedKicadPcbPoint } from "./kicad-pcb-parser";
import type { ParsedKicadProjectWarning } from "./kicad-project-parser";

/**
 * A copper zone as it appears in the file (S3a contract §8). Every optional
 * token is `null` when the file does not carry it — no numeric default is
 * invented here, so the insert step can leave the corresponding `PcbZone`
 * override absent and inherit the board rule.
 */
export interface ParsedKicadPcbZone {
  netOrdinal: number | null;
  /** `null` for ordinal 0 or an empty name — net-less copper (contract §3.2). */
  netName: string | null;
  /**
   * Canonical layer names after `F&B.Cu` / `*.Cu` expansion against THIS
   * file's copper layer table. Non-copper names are kept so the insert step
   * can warn about them.
   */
  layers: string[];
  name: string | null;
  /** Integer ≥ 0; `0` when the file carries no `(priority …)`. */
  priority: number;
  padConnection: ParsedKicadPcbZonePadConnection | null;
  clearanceMm: number | null;
  minThicknessMm: number | null;
  thermal: { gapMm: number; spokeWidthMm: number } | null;
  islandRemoval: ParsedKicadPcbZoneIslandRemoval | null;
  /** `(fill (mode hatch))` — imported as a solid fill with a warning. */
  fillModeHatch: boolean;
  locked: boolean;
  /** First contour only, arcs flattened INSCRIBED. */
  polygonPointsMm: ParsedKicadPcbPoint[];
  /**
   * Further `(polygon …)` blocks lying OUTSIDE the first contour — second
   * outlines. Dropping one pours less copper than drawn, which is safe.
   */
  extraContours: number;
  /**
   * Further `(polygon …)` blocks lying strictly INSIDE the first contour —
   * cutouts (copper-pour contract §11). Their arcs are flattened OUTWARD, the
   * opposite bias to the outline's: a cutout may only grow, so the zone never
   * pours more copper than the file draws.
   */
  holes: ParsedKicadPcbPoint[][];
}

export type ParsedKicadPcbZonePadConnection =
  "solid" | "thermal" | "thruHoleThermal" | "none";

export type ParsedKicadPcbZoneIslandRemoval =
  "always" | "never" | { minAreaMm2: number };

/** A KiCad rule area — `(zone … (keepout …))`. Rule areas make no copper. */
export interface ParsedKicadPcbKeepout {
  name: string | null;
  /** Canonical layer names, expanded exactly as {@link ParsedKicadPcbZone}. */
  layers: string[];
  /** `true` = the object class is forbidden inside the area. */
  restrictions: {
    tracks: boolean;
    vias: boolean;
    pads: boolean;
    copperPour: boolean;
    footprints: boolean;
  };
  locked: boolean;
  /** First contour only, arcs flattened CIRCUMSCRIBED. */
  polygonPointsMm: ParsedKicadPcbPoint[];
  /**
   * Further `(polygon …)` blocks, holes included. Ignoring a hole only makes
   * the forbidden area larger, so every one of them is simply dropped.
   */
  extraContours: number;
}

export type ParsedZoneOrKeepout =
  | { kind: "zone"; zone: ParsedKicadPcbZone }
  | { kind: "keepout"; keepout: ParsedKicadPcbKeepout };

/**
 * Classify one `(zone …)` node (S3a contract §8): a node carrying a direct
 * `(keepout …)` child is a KiCad rule area, everything else is copper.
 * Rule-area contours are flattened CIRCUMSCRIBED (the forbidden region may
 * only grow); copper contours INSCRIBED (copper may only shrink).
 */
export function parseZoneOrKeepout(
  node: SExpr[],
  netByOrdinal: ReadonlyMap<number, string>,
  copperLayerNames: readonly string[],
  warnings: ParsedKicadProjectWarning[],
): ParsedZoneOrKeepout | null {
  const keepoutNode = findNode(node, "keepout");
  const name = getStringValue(findNode(node, "name") ?? [], 1);
  const layers = readZoneLayers(node, copperLayerNames);
  const locked = readLockedFlag(node);
  // Outline polygons — the first `(polygon (pts …))` block is the contour;
  // computed `(filled_polygon …)` blocks are recomputed by OpenPCB later.
  // Region side, not construction — the S2 sampler picks per arc (see
  // `readContourPoints`): a zone may never gain copper, a keepout may never
  // lose forbidden area.
  const bias: OutlineBias = keepoutNode ? "outward" : "inward";
  const polygonNodes = findNodes(node, "polygon");
  const contours = polygonNodes.map((c) => readContourPoints(c, bias));
  const polygonPointsMm = contours[0] ?? [];
  if (polygonPointsMm.length < 3) return null;

  if (keepoutNode) {
    return {
      kind: "keepout",
      keepout: {
        name,
        layers,
        restrictions: readKeepoutRestrictions(keepoutNode),
        locked,
        polygonPointsMm,
        extraContours: contours.length - 1,
      },
    };
  }

  if (!layers.some(isCopperLayerName)) {
    warnings.push({
      code: "zone_no_copper_layer",
      message: `Zone ${describeZone(name)} resolves to no copper layer (${layers.join(", ") || "none"}); dropped.`,
    });
    return null;
  }

  const fillNode = findNode(node, "fill");
  return {
    kind: "zone",
    zone: {
      ...readZoneNet(node, netByOrdinal),
      layers,
      name,
      priority: readZonePriority(node),
      padConnection: readZonePadConnection(node),
      clearanceMm: readZoneClearanceMm(node),
      minThicknessMm: readNumberToken(node, "min_thickness"),
      thermal: readZoneThermal(node, fillNode),
      islandRemoval: readZoneIslandRemoval(fillNode),
      fillModeHatch:
        getStringValue(findNode(fillNode ?? [], "mode") ?? [], 1) === "hatch",
      locked,
      polygonPointsMm,
      // Classification runs against the OUTWARD flattening of the outline —
      // NOT the inward `polygonPointsMm` the zone pours (see below); only the
      // points KEPT for a cutout are re-flattened outward (§11).
      ...classifyExtraContours(
        readContourPoints(polygonNodes[0]!, "outward"),
        contours.slice(1),
        polygonNodes.slice(1).map((c) => readContourPoints(c, "outward")),
      ),
    },
  };
}

/**
 * Split the contours after the first into holes (strictly inside the outline)
 * and second outlines (everything else) — contract §8. A second outline is
 * dropped (less copper: safe); a hole is KEPT, from `outwardExtras`, the same
 * contours re-flattened with the cutout bias (copper-pour contract §11).
 *
 * `outline` is the OUTWARD flattening of the first contour — a superset of the
 * true outer, so anything strictly inside the true outer is strictly inside it.
 * Classifying against the inward flattening the zone pours is not fail-safe: a
 * chord that cuts inside a shallow arc can cross a hole that the true outer
 * contains, demoting the hole to a second outline and DROPPING it, which pours
 * copper inside the shape the file draws as a cutout. A hole whose kept outward
 * ring then fails `zoneRegionValidity` against the inward outer is not dropped
 * either — the insert step imports the zone disabled (`zone_hole_invalid_import`).
 */
function classifyExtraContours(
  outline: readonly ParsedKicadPcbPoint[],
  extras: readonly ParsedKicadPcbPoint[][],
  outwardExtras: readonly ParsedKicadPcbPoint[][],
): { extraContours: number; holes: ParsedKicadPcbPoint[][] } {
  if (extras.length === 0) return { extraContours: 0, holes: [] };
  const outlineRing = canonicalizeRing(toRingMm(outline));
  let extraContours = 0;
  const holes: ParsedKicadPcbPoint[][] = [];
  for (const [i, extra] of extras.entries()) {
    const ring = canonicalizeRing(toRingMm(extra));
    if (ring.length >= 3 && ringStrictlyInside(ring, outlineRing)) {
      holes.push(outwardExtras[i] ?? extra);
    } else {
      extraContours += 1;
    }
  }
  return { extraContours, holes };
}

function toRingMm(
  points: readonly ParsedKicadPcbPoint[],
): { x: number; y: number }[] {
  return points.map((p) => ({ x: p.xMm, y: p.yMm }));
}

function describeZone(name: string | null): string {
  return name ? `'${name}'` : "(unnamed)";
}

/** `F.Cu`, `B.Cu` and `In1.Cu`..`In30.Cu` — the ids `PcbCopperLayerId` allows. */
export function isCopperLayerName(name: string): boolean {
  return /^(F|B|In([1-9]|[12][0-9]|30))\.Cu$/.test(name);
}

/**
 * `(layer "F.Cu")` and `(layers "F.Cu" "B.Cu")`, with `F&B.Cu` and `*.Cu`
 * expanded against THIS file's copper stackup. Non-copper names survive so the
 * insert step can warn about them; duplicates are collapsed.
 */
function readZoneLayers(
  node: SExpr[],
  copperLayerNames: readonly string[],
): string[] {
  const tokens: string[] = [];
  const single = findNode(node, "layer");
  if (single) {
    const value = getStringValue(single, 1);
    if (value) tokens.push(value);
  }
  const multi = findNode(node, "layers");
  if (multi) {
    for (let i = 1; i < multi.length; i += 1) {
      const value = multi[i];
      if (typeof value === "string") tokens.push(value);
    }
  }
  const out: string[] = [];
  for (const token of tokens) {
    const expanded =
      token === "*.Cu"
        ? [...copperLayerNames]
        : token === "F&B.Cu"
          ? ["F.Cu", "B.Cu"]
          : [token];
    for (const layer of expanded) {
      if (!out.includes(layer)) out.push(layer);
    }
  }
  return out;
}

function readKeepoutRestrictions(
  keepoutNode: SExpr[],
): ParsedKicadPcbKeepout["restrictions"] {
  const forbidden = (...tags: string[]): boolean =>
    tags.some(
      (tag) =>
        getStringValue(findNode(keepoutNode, tag) ?? [], 1) === "not_allowed",
    );
  return {
    tracks: forbidden("tracks"),
    vias: forbidden("vias"),
    pads: forbidden("pads"),
    copperPour: forbidden("copperpour", "copper_pour"),
    footprints: forbidden("footprints"),
  };
}

/**
 * The one place a `(polygon …)` becomes points — outlines, holes and second
 * outlines alike. The `pts` list is rebuilt as a `PcbBoardContour` (`(xy …)` →
 * line, `(arc (start)(mid)(end))` → arc about the three points' circumcircle)
 * and handed to the S2 sampler, which reads the contour's EXACT signed area,
 * derives which side of each arc its centre is on, and picks inscribed or
 * tangent-chain per arc so the ring lands on the requested side. A fixed bias
 * per kind is wrong at a concave arc: the notch bulges the other way, so an
 * inscribed chord across it would add copper inside the notch (Astra §8).
 *
 * `bias` is therefore the REGION side, not a construction: `"inward"` for a
 * zone (polygon ⊆ true region — never more copper than drawn) and `"outward"`
 * for a keepout (polygon ⊇ true region — never a smaller forbidden area).
 * A contour with no arcs flattens to exactly its `xy` points.
 */
function readContourPoints(
  polygon: SExpr[],
  bias: OutlineBias,
): ParsedKicadPcbPoint[] {
  const pts = findNode(polygon, "pts");
  if (!pts) return [];
  let start: PcbPointMm | null = null;
  const segments: PcbOutlineSegment[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const child = pts[i];
    if (!Array.isArray(child)) continue;
    if (child[0] === "xy") {
      const x = getNumberValue(child, 1);
      const y = getNumberValue(child, 2);
      if (x === null || y === null) continue;
      if (start) segments.push({ type: "line", to: { x, y } });
      else start = { x, y };
      continue;
    }
    if (child[0] !== "arc") continue;
    const from = readPointTagged(findNode(child, "start"));
    const mid = readPointTagged(findNode(child, "mid"));
    const end = readPointTagged(findNode(child, "end"));
    if (!from || !mid || !end) continue;
    if (!start) start = { x: from.xMm, y: from.yMm };
    segments.push(arcSegmentFrom3Points(from, mid, end));
  }
  if (!start) return [];
  const base: PcbBoardContour = {
    kind: "contour",
    // The flattener reads only `start` + `segments`; the cached bbox is filled
    // in from the geometry so the record is not carrying invented numbers.
    widthMm: 0,
    heightMm: 0,
    centerMm: { x: 0, y: 0 },
    start,
    segments,
  };
  const contour: PcbBoardContour = { ...base, ...computeOutlineBboxMm(base) };
  return flattenOutline(contour, { bias }).map((p) => ({
    xMm: p.x,
    yMm: p.y,
  }));
}

/**
 * One `(arc (start)(mid)(end))` as a contour segment: the circle through the
 * three points, with the sweep direction read off the mid point. `cw` is in the
 * stored-mm frame the S2 sampler uses (`cw === false` puts the centre to the
 * LEFT of travel), which is the same raw KiCad frame the signed area is taken
 * in — so the two agree regardless of KiCad's y-down convention. A collinear /
 * degenerate arc degrades to a straight segment.
 */
function arcSegmentFrom3Points(
  start: ParsedKicadPcbPoint,
  mid: ParsedKicadPcbPoint,
  end: ParsedKicadPcbPoint,
): PcbOutlineSegment {
  const to: PcbPointMm = { x: end.xMm, y: end.yMm };
  const circle = circumcircleOf(start, mid, end);
  if (!circle) return { type: "line", to };
  const a0 = Math.atan2(start.yMm - circle.cy, start.xMm - circle.cx);
  const aMid = Math.atan2(mid.yMm - circle.cy, mid.xMm - circle.cx);
  const aEnd = Math.atan2(end.yMm - circle.cy, end.xMm - circle.cx);
  const ccwToEnd = mod2pi(aEnd - a0);
  const goesCcw = mod2pi(aMid - a0) <= ccwToEnd;
  return {
    type: "arc",
    to,
    centerMm: { x: circle.cx, y: circle.cy },
    cw: !goesCcw,
  };
}

function circumcircleOf(
  a: ParsedKicadPcbPoint,
  b: ParsedKicadPcbPoint,
  c: ParsedKicadPcbPoint,
): { cx: number; cy: number; r: number } | null {
  const [ax, ay] = [a.xMm, a.yMm];
  const [bx, by] = [b.xMm, b.yMm];
  const [cx, cy] = [c.xMm, c.yMm];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return null;
  const sa = ax * ax + ay * ay;
  const sb = bx * bx + by * by;
  const sc = cx * cx + cy * cy;
  const ux = (sa * (by - cy) + sb * (cy - ay) + sc * (ay - by)) / d;
  const uy = (sa * (cx - bx) + sb * (ax - cx) + sc * (bx - ax)) / d;
  if (!Number.isFinite(ux) || !Number.isFinite(uy)) return null;
  return { cx: ux, cy: uy, r: Math.hypot(ax - ux, ay - uy) };
}

/**
 * KiCad writes `(net N)` for the ordinal and `(net_name "STRING")` for the
 * name (ordinals are unstable across saves); the name-only `(net "STRING")`
 * spelling is tolerated too (H14 §3.8). Ordinal 0 or an empty name is
 * net-less copper (contract §3.2), never a net called "".
 */
function readZoneNet(
  node: SExpr[],
  netByOrdinal: ReadonlyMap<number, string>,
): { netOrdinal: number | null; netName: string | null } {
  const netNode = findNode(node, "net");
  const nameOnly =
    netNode && typeof netNode[1] === "string" ? netNode[1] : null;
  const netOrdinal =
    netNode && nameOnly === null ? getNumberValue(netNode, 1) : null;
  const netNameNode = findNode(node, "net_name");
  const explicit = netNameNode ? getStringValue(netNameNode, 1) : null;
  const resolved =
    explicit ??
    nameOnly ??
    (netOrdinal !== null ? (netByOrdinal.get(netOrdinal) ?? null) : null);
  const netName = netOrdinal === 0 || !resolved ? null : resolved;
  return { netOrdinal, netName };
}

function readZonePriority(node: SExpr[]): number {
  const value = readNumberToken(node, "priority");
  if (value === null || value < 0) return 0;
  return Math.floor(value);
}

/**
 * `(connect_pads yes|no|thru_hole_only …)`. KiCad omits the value token for its
 * thermal-relief default and writes only the nested `(clearance …)`, so a bare
 * node means thermal, not solid. The contract's `thermal_reliefs` spelling is
 * accepted too. An absent node leaves the override absent (board default).
 */
function readZonePadConnection(
  node: SExpr[],
): ParsedKicadPcbZonePadConnection | null {
  const connect = findNode(node, "connect_pads");
  if (!connect) return null;
  const value = getStringValue(connect, 1);
  if (value === null) return "thermal";
  if (value === "yes" || value === "true") return "solid";
  if (value === "no" || value === "false") return "none";
  if (value === "thru_hole_only") return "thruHoleThermal";
  if (value === "thermal_reliefs" || value === "thermal") return "thermal";
  return null;
}

/** `(connect_pads … (clearance x))`, falling back to a zone-level `(clearance x)`. */
function readZoneClearanceMm(node: SExpr[]): number | null {
  const connect = findNode(node, "connect_pads");
  const nested = connect ? readNumberToken(connect, "clearance") : null;
  return nested ?? readNumberToken(node, "clearance");
}

/** Only a complete `(thermal_gap g)` + `(thermal_bridge_width w)` pair counts. */
function readZoneThermal(
  node: SExpr[],
  fillNode: SExpr[] | null,
): { gapMm: number; spokeWidthMm: number } | null {
  const gapMm =
    readNumberToken(fillNode, "thermal_gap") ??
    readNumberToken(node, "thermal_gap");
  const spokeWidthMm =
    readNumberToken(fillNode, "thermal_bridge_width") ??
    readNumberToken(node, "thermal_bridge_width");
  if (gapMm === null || spokeWidthMm === null) return null;
  return { gapMm, spokeWidthMm };
}

/**
 * `(island_removal_mode 0|1|2)`; mode 2 additionally needs `(island_area_min a)`
 * — without it there is no area to honour and no default may be invented, so
 * the override stays absent.
 */
function readZoneIslandRemoval(
  fillNode: SExpr[] | null,
): ParsedKicadPcbZoneIslandRemoval | null {
  const mode = readNumberToken(fillNode, "island_removal_mode");
  if (mode === 0) return "always";
  if (mode === 1) return "never";
  if (mode !== 2) return null;
  const minAreaMm2 = readNumberToken(fillNode, "island_area_min");
  return minAreaMm2 === null ? null : { minAreaMm2 };
}
