/**
 * KiCad board/schematic frame helper — H13 §3.8 (OPENPCB-61), KF1 §2-§4
 * (docs/pcb-hardening/KF1-kicad-frame-contract.md).
 *
 * THE one K → C site for `.kicad_pcb` board items (placements, tracks, arcs,
 * vias, zones, keepouts, outline, board graphics) and `.kicad_sch` positions.
 * H14's `frame-port.ts` re-exports this module verbatim; every import call site
 * converts through it. Pure: no DB access, no library-module import (H13 §3.11).
 *
 * Two frames:
 * - `KICAD_CANONICAL_FRAME_V1` — KF1: `p_C = N·p_K` with `N = diag(1,−1)`,
 *   angles unchanged, back-side placements `θ + 180` and mirrored (KF1 §3).
 * - `KICAD_LEGACY_FRAME` — the pre-H13 importer's verbatim Y-down behaviour,
 *   minus its integer rounding of angles. Selected while the installed
 *   `@openpcb/kicad-import` is not qualified (its previews carry no KF1 stamp),
 *   so a board never mixes a canonical frame with Y-down library footprints.
 *
 * `mirrored` everywhere means the OpenPCB placement convention: negate local x
 * first, then rotate math-CCW (`transformPadCenterMm`, `transformLocalPointNm`).
 */
import type { SExpr } from "@openpcb/kicad-parsers";
import {
  norm360,
  norm360Grid,
} from "../../../../../shared/kicad-frame/angles";
import {
  type UnplaceOptions,
  unplaceBoardFootprint,
} from "../../../../../shared/kicad-frame/board-footprint-unplace";
import {
  QUALIFIED_KICAD_TRANSFORM_VERSIONS,
  parseFootprintFrame,
} from "../../../../../shared/pcb-geometry/footprint-frame";

export { norm360 };

export type KicadFrameId = "kicad-legacy-unqualified" | "kicad-canonical-v1";
export const KICAD_BOARD_TRANSFORM_VERSION = 1;

export type KicadSide = "front" | "back";
export type KicadSchMirror = "x" | "y" | null;

export interface KicadPointMm {
  xMm: number;
  yMm: number;
}

export interface KicadBBoxMm {
  minXMm: number;
  minYMm: number;
  maxXMm: number;
  maxYMm: number;
}

export interface KicadBoardFrame {
  readonly id: KicadFrameId;
  /** World point to integer nm (KF1 §2 rounding: round in K, then negate). */
  point(p: KicadPointMm): { x: number; y: number };
  /** World point to mm (no rounding). */
  pointMm(p: KicadPointMm): { x: number; y: number };
  /** Canonical: `minY = −maxY`, `maxY = −minY`. */
  bboxMm(b: KicadBBoxMm): KicadBBoxMm;
  /** Canonical: `norm360(θ + (back ? 180 : 0))` (KF1 §3); legacy: `norm360(θ)`. 1e-9° grid. */
  placementRotationDeg(kicadDeg: number, side: KicadSide): number;
  /** Back ⇒ true in both frames. */
  placementMirrored(side: KicadSide): boolean;
  /** `norm360(θ)` in both frames (angles are unchanged by `N`, KF1 §2). */
  textRotationDeg(kicadDeg: number): number;
  /** Canonical: `!cwInK` (a reflection reverses the sweep, KF1 §2); legacy: identity. */
  arcSegmentCw(cwInK: boolean): boolean;
  /**
   * Board-instance `(footprint …)` to its library form (frame K, front side).
   * Canonical: `unplaceBoardFootprint(node).node`, which must agree with `side`.
   * Legacy: front ⇒ the node as written, back ⇒ null (cannot be ingested).
   * `opts.copperLayerCount` (optional, not in H14's seam) lets inner-layer
   * graphics of a back-side footprint flip on a ≥ 4-layer board (E11).
   */
  footprintToLibraryForm(
    node: SExpr[],
    side: KicadSide,
    opts?: UnplaceOptions,
  ): SExpr[] | null;
  /** Schematic world point to integer nm; the same `N` as `point()`. */
  schPoint(p: KicadPointMm): { x: number; y: number };
  /** `.kicad_sch` symbol `(at … θ)` + `(mirror x|y)` to the OpenPCB part transform. */
  schSymbolTransform(
    kicadDeg: number,
    mirror: KicadSchMirror,
  ): { rotationDeg: number; mirrored: boolean };
}

const NM_PER_MM = 1_000_000;
const STRING_STAMP_TOOL = "@openpcb/kicad-import";

function finite(v: number, what: string): number {
  if (!Number.isFinite(v)) {
    throw new RangeError(`KicadBoardFrame: non-finite ${what} (${v})`);
  }
  return v;
}

/** Collapses `−0` to `0`. */
function zero(v: number): number {
  return v === 0 ? 0 : v;
}

function neg(v: number): number {
  return v === 0 ? 0 : -v;
}

function toNm(mm: number, what: string): number {
  return zero(Math.round(finite(mm, what) * NM_PER_MM));
}

/** `norm360` (KF1 §2) on its 1e-9° grid, so `θ + 180` carries no float noise. */
function angle(deg: number): number {
  return norm360Grid(finite(deg, "angle"));
}

export const KICAD_CANONICAL_FRAME_V1: KicadBoardFrame = Object.freeze({
  id: "kicad-canonical-v1",
  point: (p: KicadPointMm) => ({
    x: toNm(p.xMm, "xMm"),
    y: neg(toNm(p.yMm, "yMm")),
  }),
  pointMm: (p: KicadPointMm) => ({
    x: zero(finite(p.xMm, "xMm")),
    y: neg(finite(p.yMm, "yMm")),
  }),
  bboxMm: (b: KicadBBoxMm) => ({
    minXMm: zero(finite(b.minXMm, "minXMm")),
    minYMm: neg(finite(b.maxYMm, "maxYMm")),
    maxXMm: zero(finite(b.maxXMm, "maxXMm")),
    maxYMm: neg(finite(b.minYMm, "minYMm")),
  }),
  placementRotationDeg: (kicadDeg: number, side: KicadSide) =>
    angle(finite(kicadDeg, "angle") + (side === "back" ? 180 : 0)),
  placementMirrored: (side: KicadSide) => side === "back",
  textRotationDeg: angle,
  arcSegmentCw: (cwInK: boolean) => !cwInK,
  footprintToLibraryForm: (
    node: SExpr[],
    side: KicadSide,
    opts?: UnplaceOptions,
  ) => {
    const unplaced = unplaceBoardFootprint(node, opts);
    if (unplaced.side !== side) {
      throw new Error(
        `footprintToLibraryForm: '${unplaced.libId}' is on the ${unplaced.side} side, caller said ${side}`,
      );
    }
    return unplaced.node;
  },
  schPoint: (p: KicadPointMm) => ({
    x: toNm(p.xMm, "xMm"),
    y: neg(toNm(p.yMm, "yMm")),
  }),
  schSymbolTransform: canonicalSchSymbolTransform,
});

export const KICAD_LEGACY_FRAME: KicadBoardFrame = Object.freeze({
  id: "kicad-legacy-unqualified",
  point: (p: KicadPointMm) => ({
    x: toNm(p.xMm, "xMm"),
    y: toNm(p.yMm, "yMm"),
  }),
  pointMm: (p: KicadPointMm) => ({
    x: zero(finite(p.xMm, "xMm")),
    y: zero(finite(p.yMm, "yMm")),
  }),
  bboxMm: (b: KicadBBoxMm) => ({
    minXMm: zero(finite(b.minXMm, "minXMm")),
    minYMm: zero(finite(b.minYMm, "minYMm")),
    maxXMm: zero(finite(b.maxXMm, "maxXMm")),
    maxYMm: zero(finite(b.maxYMm, "maxYMm")),
  }),
  placementRotationDeg: (kicadDeg: number) => angle(kicadDeg),
  placementMirrored: (side: KicadSide) => side === "back",
  textRotationDeg: angle,
  arcSegmentCw: (cwInK: boolean) => cwInK,
  footprintToLibraryForm: (node: SExpr[], side: KicadSide) =>
    side === "front" ? node : null,
  schPoint: (p: KicadPointMm) => ({
    x: toNm(p.xMm, "xMm"),
    y: toNm(p.yMm, "yMm"),
  }),
  // The pre-H13 importer ignored `(mirror …)` entirely.
  schSymbolTransform: (kicadDeg: number) => ({
    rotationDeg: angle(kicadDeg),
    mirrored: false,
  }),
});

/**
 * KiCad 8.0.4 (gitlab.com/kicad/code/kicad/-/raw/8.0.4):
 * - `eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:2858-2884`: `(at … θ)` sets the
 *   Y-down transform `A(θ)` = `N·R(θ)`, then `(mirror x|y)` applies `SetOrientation(SYM_MIRROR_X|Y)`;
 * - `eeschema/sch_symbol.cpp:1621-1767`: a mirror is `A ← B·A` with `B_x = diag(1,−1)`,
 *   `B_y = diag(−1,1)`; pins land at `at + A·p` (`:2181`, `libs/kimath/src/transform.cpp:44`).
 * In C: `N·B·N·R(θ)`. Mirror y: `M_x·R(θ) = R(−θ)·M_x`. Mirror x: `N·R(θ) = R(180−θ)·M_x`.
 * The H13 §3.8 "initial expectation" (x ⇒ θ+180, y ⇒ θ) agrees only at θ = 0; the OP11
 * corpus pin oracle (`kicad-sch-mirror-oracle.test.ts`) stays the binding check.
 */
function canonicalSchSymbolTransform(
  kicadDeg: number,
  mirror: KicadSchMirror,
): { rotationDeg: number; mirrored: boolean } {
  const theta = finite(kicadDeg, "angle");
  if (mirror === "y") return { rotationDeg: angle(-theta), mirrored: true };
  if (mirror === "x") return { rotationDeg: angle(180 - theta), mirrored: true };
  return { rotationDeg: angle(theta), mirrored: false };
}

/** `"openpcb-y-up/kicad-converted/1"` → a stamp object, else null (H14's string-typed port). */
function parseStampString(value: string): unknown {
  const parts = value.split("/");
  if (parts.length !== 3 || !/^[1-9]\d*$/.test(parts[2]!)) return null;
  return {
    frame: parts[0],
    origin: parts[1],
    transformVersion: Number(parts[2]),
    tool: STRING_STAMP_TOOL,
  };
}

/**
 * Canonical iff the footprint frame stamp of the installed `@openpcb/kicad-import`
 * (H14's `KICAD_IMPORT_FRAME_STAMP` probe) parses strictly as `kicad-converted` with a
 * qualified transform version; anything else (absent on 0.1.2, authored, unknown
 * version, malformed) selects the legacy frame.
 */
export function selectBoardFrame(footprintFrameStamp: unknown): KicadBoardFrame {
  const candidate =
    typeof footprintFrameStamp === "string"
      ? parseStampString(footprintFrameStamp)
      : footprintFrameStamp;
  const parsed = parseFootprintFrame(candidate);
  const canonical =
    parsed !== null &&
    parsed.origin === "kicad-converted" &&
    QUALIFIED_KICAD_TRANSFORM_VERSIONS.includes(parsed.transformVersion);
  return canonical ? KICAD_CANONICAL_FRAME_V1 : KICAD_LEGACY_FRAME;
}

/** Written by H14 into `commandLog.command_json.frame` and the import report. */
export function boardImportFrameStamp(frame: KicadBoardFrame): {
  frame: KicadFrameId;
  kicadBoardTransformVersion: number | null;
} {
  return {
    frame: frame.id,
    kicadBoardTransformVersion:
      frame.id === "kicad-canonical-v1" ? KICAD_BOARD_TRANSFORM_VERSION : null,
  };
}
