/**
 * Footprint frame provenance predicates — KF1 §3.1.2 / H13 §3.2.3
 * (docs/pcb-hardening/KF1-kicad-frame-contract.md).
 *
 * A `provenance.frame` stamp is a CLAIM, never evidence: `isQualifiedFootprintFrame`
 * checks shape and version only. Evidence comes from `rawFrameRelation`, which
 * re-derives the KF1 geometry relation between a row's KiCad raw (frame K) and its
 * preview. `expectedCentreV1` is implemented here independently of
 * `@openpcb/kicad-import`, so the classifier never trusts the producer it checks.
 */
import type {
  FootprintFrameProvenance,
  LibraryFootprintFrameClass,
  LibraryFootprintFrameEvidence,
} from "../../sdks/library/types";
import { rawPointMm, rawPolyPoints } from "./raw-graphics";

// Derived from the SDK so this module imports `sdks` types only (H13 §3.11).
type FootprintPreview = NonNullable<
  LibraryFootprintFrameEvidence["currentPreview"]
>;
type PreviewPad = FootprintPreview["pads"][number];
type Pt = { readonly x: number; readonly y: number };

export const CANONICAL_FOOTPRINT_FRAME = "openpcb-y-up" as const;
export const QUALIFIED_KICAD_TRANSFORM_VERSIONS: readonly number[] =
  Object.freeze([1]);

const MAX_TOOL_LENGTH = 128;
const DEFAULT_TOL_MM = 1e-6;
const ANGLE_EPS_DEG = 1e-9;
const COPPER_SHAPES: ReadonlySet<string> = new Set([
  "rect",
  "oval",
  "roundrect",
  "circle",
]);

// ── Stamp shape ────────────────────────────────────────────────────────────

/** Strict parse of a `provenance.frame` value; a fresh object with the four KF1 keys, or null. */
export function parseFootprintFrame(
  value: unknown,
): FootprintFrameProvenance | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const v = value as Record<string, unknown>;
  if (v.frame !== CANONICAL_FOOTPRINT_FRAME) return null;
  const origin = v.origin;
  if (origin !== "kicad-converted" && origin !== "authored") return null;
  const version = v.transformVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) return null;
  if (origin === "kicad-converted" ? version < 1 : version !== 0) return null;
  const tool = v.tool;
  if (typeof tool !== "string" || tool.trim().length === 0) return null;
  if (tool.length > MAX_TOOL_LENGTH) return null;
  return {
    frame: CANONICAL_FOOTPRINT_FRAME,
    origin,
    transformVersion: version === 0 ? 0 : version,
    tool,
  };
}

/** Shape/version check ONLY — never sufficient on its own to qualify a row (H13 §3.5.1). */
export function isQualifiedFootprintFrame(
  f: FootprintFrameProvenance | null,
): boolean {
  const parsed = parseFootprintFrame(f);
  if (!parsed) return false;
  if (parsed.origin === "authored") return true;
  return QUALIFIED_KICAD_TRANSFORM_VERSIONS.includes(parsed.transformVersion);
}

export function authoredFrame(tool: string): FootprintFrameProvenance {
  return {
    frame: CANONICAL_FOOTPRINT_FRAME,
    origin: "authored",
    transformVersion: 0,
    tool,
  };
}

export function isVerifiedFrameClass(
  cls: LibraryFootprintFrameClass | undefined,
): boolean {
  return cls === "kicad-converted" || cls === "authored";
}

// ── Angles and pad fields (structural reads: the pinned pad type lacks them) ─

function modDeg(deg: number, m: number): number {
  return ((deg % m) + m) % m;
}

function isMultipleOf(deg: number, m: number): boolean {
  const r = modDeg(deg, m);
  return r <= ANGLE_EPS_DEG || m - r <= ANGLE_EPS_DEG;
}

function anglesEqual(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && isMultipleOf(a - b, 360);
}

const CARDINAL_COS_SIN: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 0],
  [90, 0, 1],
  [180, -1, 0],
  [270, 0, -1],
  [360, 1, 0],
];

/** cos/sin of a degree angle, exact at the four cardinals. */
function cosSinDeg(deg: number): [number, number] {
  const d = modDeg(deg, 360);
  for (const [at, c, s] of CARDINAL_COS_SIN) {
    if (Math.abs(d - at) <= ANGLE_EPS_DEG) return [c, s];
  }
  const rad = (d * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

function finitePt(value: unknown): Pt | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number") return null;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function isPastePad(pad: PreviewPad): boolean {
  return (pad as { role?: unknown }).role === "paste";
}

/** Pad-local drill offset; (0,0) is no offset, matching `padDrillFields`. */
function padDrillOffset(pad: PreviewPad): Pt | null {
  const off = finitePt((pad as { drillOffsetMm?: unknown }).drillOffsetMm);
  return off && (off.x !== 0 || off.y !== 0) ? off : null;
}

function padDrillSlot(pad: PreviewPad): Pt | null {
  const slot = (
    pad as { drillSlotMm?: { widthMm?: unknown; heightMm?: unknown } }
  ).drillSlotMm;
  return slot ? finitePt({ x: slot.widthMm, y: slot.heightMm }) : null;
}

function nearPt(a: Pt | null, b: Pt | null, tol: number): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

function nearOpt(
  a: number | undefined,
  b: number | undefined,
  tol: number,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) <= tol;
}

// ── Copper predicates ──────────────────────────────────────────────────────

/**
 * True when every non-paste pad is its own mirror under N = diag(1,−1): centre on
 * y = 0, a quarter-turn rotation of a mirror-symmetric shape, and the hole (centre
 * + R(β)·drillOffset) on y = 0 as well. Such copper reads the same in K and C.
 */
export function isCopperFrameInvariant(preview: FootprintPreview): boolean {
  for (const pad of preview.pads) {
    if (isPastePad(pad)) continue;
    if (!COPPER_SHAPES.has(pad.shape)) return false;
    if (!(Math.abs(pad.centerMm.y) <= DEFAULT_TOL_MM)) return false;
    if (!Number.isFinite(pad.rotationDeg) || !isMultipleOf(pad.rotationDeg, 90))
      return false;
    const off = padDrillOffset(pad);
    if (off) {
      const [c, s] = cosSinDeg(pad.rotationDeg);
      if (!(Math.abs(pad.centerMm.y + off.x * s + off.y * c) <= DEFAULT_TOL_MM))
        return false;
    }
  }
  return true;
}

function padsCopperEqual(a: PreviewPad, b: PreviewPad, tol: number): boolean {
  return (
    a.number === b.number &&
    a.shape === b.shape &&
    isPastePad(a) === isPastePad(b) &&
    nearPt(a.centerMm, b.centerMm, tol) &&
    Math.abs(a.widthMm - b.widthMm) <= tol &&
    Math.abs(a.heightMm - b.heightMm) <= tol &&
    anglesEqual(a.rotationDeg, b.rotationDeg) &&
    nearOpt(a.roundrectRatio, b.roundrectRatio, tol) &&
    nearOpt(a.drillDiameterMm, b.drillDiameterMm, tol) &&
    ((a as { plated?: unknown }).plated !== false) ===
      ((b as { plated?: unknown }).plated !== false) &&
    nearPt(padDrillSlot(a), padDrillSlot(b), tol) &&
    nearPt(padDrillOffset(a), padDrillOffset(b), tol)
  );
}

/** Same pad ids with equal numbers, shapes, centres, sizes, rotations, drills and offsets. */
export function previewCopperEqual(
  a: FootprintPreview,
  b: FootprintPreview,
  tolMm = DEFAULT_TOL_MM,
): boolean {
  if (a.pads.length !== b.pads.length) return false;
  const byId = new Map(b.pads.map((pad) => [pad.id, pad] as const));
  if (byId.size !== b.pads.length) return false;
  return a.pads.every((pad) => {
    const other = byId.get(pad.id);
    return other !== undefined && padsCopperEqual(pad, other, tolMm);
  });
}

/** Numbers within `tol`, everything else strictly equal, keys unioned. */
function deepNear(a: unknown, b: unknown, tol: number): boolean {
  if (typeof a === "number" && typeof b === "number")
    return Math.abs(a - b) <= tol;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return a === b;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const key of keys) if (!deepNear(ra[key], rb[key], tol)) return false;
  return true;
}

/**
 * Copper, plus every graphic's geometry, plus label positions and rotations (in
 * order). Label ids and text are ignored: ids embed coordinates (H13 E7).
 */
export function previewEqual(
  a: FootprintPreview,
  b: FootprintPreview,
  tolMm = DEFAULT_TOL_MM,
): boolean {
  if (!previewCopperEqual(a, b, tolMm)) return false;
  if (!deepNear(a.graphics, b.graphics, tolMm)) return false;
  if (a.labels.length !== b.labels.length) return false;
  return a.labels.every((label, i) => {
    const other = b.labels[i]!;
    return (
      label.layer === other.layer &&
      nearPt(label.at, other.at, tolMm) &&
      anglesEqual(label.rotationDeg, other.rotationDeg)
    );
  });
}

// ── KF1 raw ↔ preview relation ─────────────────────────────────────────────

/** The fields of a parsed KiCad pad (frame K) the KF1 relation reads. */
export interface KicadRawPadPosition {
  readonly number?: string;
  readonly position: Pt;
  readonly rotation: number;
  readonly drillOffset?: Pt;
}

/**
 * KF1 transform version 1: `N·(position + RotK(drillOffset ?? 0, rotation))`, where
 * KiCad `RotatePoint` is `RotK(p,θ) = (x cosθ + y sinθ, −x sinθ + y cosθ)` and the
 * copper sits at the offset point (`PAD::ShapePos`). `−0` is normalized to `0`.
 */
export function expectedCentreV1(raw: KicadRawPadPosition): Pt {
  const off = raw.drillOffset ?? { x: 0, y: 0 };
  const [c, s] = cosSinDeg(raw.rotation);
  const kx = raw.position.x + off.x * c + off.y * s;
  const ky = raw.position.y - off.x * s + off.y * c;
  return { x: kx === 0 ? 0 : kx, y: ky === 0 ? 0 : -ky };
}

export type RawFrameRelation =
  "verbatim" | "converted-v1" | "invariant" | "neither" | "unusable";

function parseRawPad(value: unknown): KicadRawPadPosition | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as {
    number?: unknown;
    position?: unknown;
    rotation?: unknown;
    drillOffset?: unknown;
  };
  const position = finitePt(v.position);
  if (!position) return null;
  const rotation = v.rotation === undefined ? 0 : v.rotation;
  if (typeof rotation !== "number" || !Number.isFinite(rotation)) return null;
  const drillOffset =
    v.drillOffset === undefined ? undefined : finitePt(v.drillOffset);
  if (drillOffset === null) return null;
  return {
    ...(typeof v.number === "string" ? { number: v.number.trim() } : {}),
    position,
    rotation,
    ...(drillOffset ? { drillOffset } : {}),
  };
}

type PadPairs = Array<{ pad: PreviewPad; raw: KicadRawPadPosition }>;

/** Pairs each non-paste preview pad `n:i` with raw pad `i`. */
function pairPads(
  preview: FootprintPreview,
  rawPads: unknown,
): PadPairs | "neither" | "unusable" {
  if (!Array.isArray(rawPads) || rawPads.length === 0) return "unusable";
  const pairs: PadPairs = [];
  let numberMismatch = false;
  for (const pad of preview.pads) {
    if (isPastePad(pad)) continue;
    const match = /:(\d+)$/.exec(pad.id);
    const raw = match ? parseRawPad(rawPads[Number(match[1])]) : null;
    if (!raw) return "unusable";
    if (raw.number !== undefined && raw.number !== pad.number)
      numberMismatch = true;
    pairs.push({ pad, raw });
  }
  if (pairs.length === 0) return "unusable";
  return numberMismatch ? "neither" : pairs;
}

/**
 * KF1 geometry relation between raw (K) pads and preview pads, per electrical pad
 * id `n:i`. `verbatim`: every centre equals `raw.position`; `converted-v1`: every
 * centre equals `expectedCentreV1(raw)`. When both hold (y-symmetric copper),
 * asymmetric graphic/text positions decide; `invariant` only when they cannot.
 */
export function rawFrameRelation(
  preview: FootprintPreview | null | undefined,
  rawPads: unknown,
  rawGraphics?: unknown,
): RawFrameRelation {
  if (!preview || !Array.isArray(preview.pads)) return "unusable";
  const pairs = pairPads(preview, rawPads);
  if (pairs === "neither" || pairs === "unusable") return pairs;
  let verbatim = true;
  let converted = true;
  for (const { pad, raw } of pairs) {
    if (!nearPt(pad.centerMm, raw.position, DEFAULT_TOL_MM)) verbatim = false;
    if (!nearPt(pad.centerMm, expectedCentreV1(raw), DEFAULT_TOL_MM))
      converted = false;
  }
  if (verbatim && converted) return graphicsRelation(preview, rawGraphics);
  if (verbatim) return "verbatim";
  return converted ? "converted-v1" : "neither";
}

type LayerPt = {
  readonly layer: string | undefined;
  readonly x: number;
  readonly y: number;
};

function previewPoints(preview: FootprintPreview): LayerPt[] {
  const out: LayerPt[] = [];
  const add = (layer: string | undefined, p: Pt) =>
    out.push({ layer, x: p.x, y: p.y });
  for (const g of preview.graphics) {
    if (g.kind === "line") [g.a, g.b].forEach((p) => add(g.layer, p));
    else if (g.kind === "rect") {
      for (const [x, y] of [
        [g.x, g.y],
        [g.x + g.width, g.y],
        [g.x, g.y + g.height],
        [g.x + g.width, g.y + g.height],
      ]) {
        add(g.layer, { x: x!, y: y! });
      }
    } else if (g.kind === "circle") add(g.layer, g.center);
    else if (g.kind === "arc3")
      [g.start, g.mid, g.end].forEach((p) => add(g.layer, p));
    else if (g.kind === "polyline" || g.kind === "bezier")
      g.points.forEach((p) => add(g.layer, p));
  }
  for (const label of preview.labels) add(label.layer, label.at);
  return out;
}

type RawGraphic = {
  type?: unknown;
  layer?: unknown;
  data?: unknown;
  text?: { position?: unknown; hidden?: unknown };
};

/**
 * The points of one raw graphic that a preview reproduces. A circle's `end` and a
 * hidden text are never drawn, so they would only add spurious mirror matches.
 */
function rawGraphicPointList(g: RawGraphic): Array<Pt | null> {
  const data = (
    typeof g.data === "object" && g.data !== null ? g.data : {}
  ) as Record<string, unknown>;
  switch (g.type) {
    case "line":
      return [rawPointMm(data.start), rawPointMm(data.end)];
    case "rect": {
      const a = rawPointMm(data.start);
      const b = rawPointMm(data.end);
      return a && b ? [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }] : [];
    }
    case "circle":
      return [rawPointMm(data.center)];
    case "arc":
      return [
        rawPointMm(data.start),
        rawPointMm(data.mid),
        rawPointMm(data.end),
      ];
    case "poly":
      return rawPolyPoints(data);
    case "text":
      if (g.text?.hidden === true) return [];
      return [finitePt(g.text?.position) ?? rawPointMm(data.at)];
    default:
      return [];
  }
}

/** Points of raw KiCad graphics (`parseKicadFootprint` records), frame K. */
function rawGraphicPoints(rawGraphics: unknown): LayerPt[] {
  if (!Array.isArray(rawGraphics)) return [];
  const out: LayerPt[] = [];
  for (const entry of rawGraphics) {
    if (typeof entry !== "object" || entry === null) continue;
    const g = entry as RawGraphic;
    const layer = typeof g.layer === "string" ? g.layer : undefined;
    for (const p of rawGraphicPointList(g))
      if (p) out.push({ layer, x: p.x, y: p.y });
  }
  return out;
}

function hasPoint(points: readonly LayerPt[], q: LayerPt): boolean {
  return points.some(
    (p) =>
      (p.layer === undefined || q.layer === undefined || p.layer === q.layer) &&
      Math.abs(p.x - q.x) <= DEFAULT_TOL_MM &&
      Math.abs(p.y - q.y) <= DEFAULT_TOL_MM,
  );
}

/**
 * Counts raw points (off the x axis) found in the preview ONLY as-is versus ONLY
 * mirrored. Contradictory evidence fails closed as `neither`.
 */
function graphicsRelation(
  preview: FootprintPreview,
  rawGraphics: unknown,
): RawFrameRelation {
  const target = previewPoints(preview);
  let verbatimOnly = 0;
  let convertedOnly = 0;
  for (const r of rawGraphicPoints(rawGraphics)) {
    if (Math.abs(r.y) <= DEFAULT_TOL_MM) continue;
    const asIs = hasPoint(target, r);
    const mirrored = hasPoint(target, { layer: r.layer, x: r.x, y: -r.y });
    if (asIs && !mirrored) verbatimOnly += 1;
    else if (mirrored && !asIs) convertedOnly += 1;
  }
  if (verbatimOnly > 0 && convertedOnly > 0) return "neither";
  if (verbatimOnly > 0) return "verbatim";
  return convertedOnly > 0 ? "converted-v1" : "invariant";
}
