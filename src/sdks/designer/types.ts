import type { CommandEnvelope } from "../../shared/domain/commands/command-envelope";
import type {
  LibraryComponent,
  LibraryComponentPlacementDetail,
  LibraryFootprintPlacementSnapshot,
  LibrarySymbolPlacementSnapshot,
} from "../library";

export type DesignerEntityKind = "part" | "wire" | "label" | "primitive";

/** First-class schematic primitives for power/ground/portal — distinct from
 *  library components. They have no footprint and never become PCB
 *  placements. Net derivation uses them to force net names and to globally
 *  join sub-graphs by portal text. */
export type DesignerPrimitiveKind = "gnd" | "pwr" | "net_portal";

/**
 * Compact DRC status for the design card. Sourced from the latest persisted
 * DRC run. `stale` = the design has been edited since DRC last ran
 * (`ranAtRevision !== design.revision`). Absent/null = DRC never run.
 */
export interface DesignerDrcStatus {
  ranAtRevision: number;
  ranAt: string;
  errors: number;
  warnings: number;
  infos: number;
  stale: boolean;
}

export interface DesignerDesignSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Cached schematic preview for Home-screen thumbnails. Populated by
   *  `listDesigns`; omitted from command/create results. */
  schematicPreview?: DesignerSchematicPreview | null;
  /** Latest DRC status for the card badge. Populated by `listDesigns`. */
  drcStatus?: DesignerDrcStatus | null;
}

export interface DesignerEntityRecord {
  id: string;
  designId: string;
  kind: DesignerEntityKind;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DesignerDesignRecord {
  head: DesignerDesignSummary;
  entities: DesignerEntityRecord[];
}

export interface CreateDesignerDesignInput {
  name?: string;
}

export interface UpdateDesignerDesignInput {
  name: string;
}

export interface DesignerSchematicProjection {
  designId: string;
  revision: number;
  parts: DesignerPlacedPart[];
  wires: DesignerWire[];
  labels: DesignerLabel[];
  primitives: DesignerPrimitive[];
  junctions: DesignerJunction[];
  nets: DesignerDerivedNet[];
}

/** Compact schematic snapshot for Home-screen thumbnails. Carries the vector
 *  geometry needed to draw an auto-fit SVG preview — placed-symbol
 *  graphics/bounds + pin stubs (mm), wire polylines (nm), and power/ground/
 *  portal primitives — without footprints, labels, or derived nets.
 *
 *  `schemaVersion` lets the cache (`designer_design_heads.schematic_preview_json`)
 *  detect a shape change and recompute even when the design revision is unchanged. */
export interface DesignerSchematicPreview {
  schemaVersion: number;
  designId: string;
  revision: number;
  parts: Array<{
    positionNm: { x: number; y: number };
    rotationDeg: number;
    mirrored: boolean;
    graphics: LibrarySymbolPlacementSnapshot["preview"]["graphics"];
    bounds: LibrarySymbolPlacementSnapshot["preview"]["bounds"];
    /** Pin stub segments in local mm (anchor = wire connection point). */
    pins: Array<{
      anchor: { x: number; y: number };
      bodyEnd: { x: number; y: number };
    }>;
  }>;
  wires: Array<{ pointsNm: Array<{ x: number; y: number }> }>;
  /** Power/ground/portal primitives (geometry templated client-side per kind). */
  primitives: Array<{
    kind: DesignerPrimitiveKind;
    positionNm: { x: number; y: number };
    rotationDeg: number;
  }>;
}

/**
 * PCB layer identifier. The wire-format contract — persisted in `board_settings`
 * payloadJson. Adding a layer here means migrations must accept it; removing
 * one means a migration must rewrite saved boards. Kept in sync with the
 * frontend canvas `PcbLayerId` in `src/shared/frontend/canvas/layers.ts`.
 *
 * Grouping:
 *  - Copper:     F.Cu, In1.Cu, In2.Cu, B.Cu  (traces + vias + pads live here)
 *  - Solder mask:F.Mask, B.Mask              (translucent green overlay)
 *  - Solder paste:F.Paste, B.Paste           (SMD stencil aperture)
 *  - Silkscreen: F.SilkS, B.SilkS            (component outlines + refdes)
 *  - Courtyard:  F.CrtYd, B.CrtYd            (no-go zone marker)
 *  - Fabrication:F.Fab, B.Fab                (assembly notes, hidden by default)
 *  - Edge:       Edge.Cuts                   (board outline)
 *  - Drill:      Drill                       (virtual layer — all PTH + via holes)
 *  - Metadata:   Metadata                    (refdes/value annotation)
 */
export type PcbLayerId =
  | "F.Cu"
  | "In1.Cu"
  | "In2.Cu"
  | "B.Cu"
  | "F.Mask"
  | "B.Mask"
  | "F.Paste"
  | "B.Paste"
  | "F.SilkS"
  | "B.SilkS"
  | "F.CrtYd"
  | "B.CrtYd"
  | "F.Fab"
  | "B.Fab"
  | "Edge.Cuts"
  | "Drill"
  | "Metadata";

/** Subset of PcbLayerId that traces and vias may live on (copper only). */
export type PcbCopperLayerId = "F.Cu" | "In1.Cu" | "In2.Cu" | "B.Cu";

/**
 * Display emphasis mode controlling how non-active layers render relative to
 * the active layer. Mirrors KiCad's Ctrl+H cycle.
 *  - `normal`: every visible layer at full color/opacity.
 *  - `dim`:    non-active layers desaturated + reduced opacity (~0.18).
 *  - `solo`:   non-active layers hidden entirely.
 */
export type PcbDisplayMode = "normal" | "dim" | "solo";

/** Stackup layer count. v1 supports 2 or 4 (inner copper = In1.Cu/In2.Cu). */
export type PcbLayerCount = 2 | 4;

export type PcbTraceSegmentMode = "manhattan-90" | "manhattan-45";

/** Side of the board the viewer is looking at. Drives X-mirror + z-flip. */
export type PcbViewSide = "top" | "bottom";

/**
 * Built-in layer-set presets. Match the four cards the user picked during
 * planning. `custom` = user-modified visibility set (no preset matched). The
 * canvas tracks the active preset so the panel can highlight it; switching
 * presets replaces visibleLayers + activeLayer + (optionally) viewSide.
 */
export type PcbLayerPreset =
  | "custom"
  | "top-side"
  | "bottom-side"
  | "all-copper"
  | "assembly";

/**
 * Per-design persisted display state. Carries everything the layer panel /
 * canvas chrome needs to re-render identically on reload. Additive: missing
 * fields fall back to defaults (no destructive migration).
 *
 *  - copperFillLayers: which copper layers render their pour mesh.
 *  - copperFillPourNetIds: pour-net per copper layer; objects on the same net
 *    merge silently into the pour; different-net objects render with a visible
 *    clearance halo (spec §7). null/undefined = no merging (every object haloed).
 *  - perLayerOpacity: 0..1 override applied on top of displayMode dimming.
 *  - layerPreset: tracks which built-in preset (if any) the visibleLayers set
 *    currently matches; UI uses it to highlight the active preset chip.
 */
export interface PcbViewState {
  displayMode: PcbDisplayMode;
  viewSide: PcbViewSide;
  copperFillLayers: PcbCopperLayerId[];
  copperFillPourNetIds: Partial<Record<PcbCopperLayerId, string | null>>;
  perLayerOpacity: Partial<Record<PcbLayerId, number>>;
  layerPreset: PcbLayerPreset;
  ratsnestVisible: boolean;
  /**
   * DRC rule-classes the user has chosen to ignore wholesale (panel "ignore
   * all" toggles). Violations in these classes are not emitted. Additive;
   * absent = ignore nothing.
   */
  drcIgnoredRuleClasses?: DrcRuleClass[];
  /**
   * Stable ids of individually waived DRC violations. Waived violations are
   * still listed (struck-through) but excluded from the active summary counts.
   * Additive; absent = no waivers.
   */
  drcWaivedViolationIds?: string[];
}

export interface PcbPointMm {
  x: number;
  y: number;
}

export type PcbBoardOutline =
  | PcbBoardOutlineRect
  | PcbBoardOutlineRoundRect
  | PcbBoardOutlineCircle
  | PcbBoardOutlinePolygon
  | PcbBoardContour;

/**
 * Every outline variant carries a `widthMm` / `heightMm` / `centerMm` bounding
 * box. For non-rect shapes this is a *cache* of the shape's extent — kept so
 * consumers that only need the board footprint (3D enclosure, fab presets,
 * legacy code) keep working without shape awareness. Recompute it with
 * `computeOutlineBboxMm` whenever the shape geometry changes.
 */
export interface PcbBoardOutlineRect {
  kind: "rect";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
}

/** Rounded rectangle with a single (uniform) corner radius. */
export interface PcbBoardOutlineRoundRect {
  kind: "roundrect";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
  cornerRadiusMm: number;
}

/**
 * Circle / ellipse. `widthMm` / `heightMm` are the bounding box (= the two
 * diameters); a circle has `widthMm === heightMm`. An oval has them differ.
 */
export interface PcbBoardOutlineCircle {
  kind: "circle";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
}

/**
 * Closed polygon outline imported from KiCad's Edge.Cuts graphics. Line-only
 * (no arc fidelity). Kept for back-compat with existing KiCad imports; new
 * free-form shapes use `PcbBoardContour` instead.
 */
export interface PcbBoardOutlinePolygon {
  kind: "polygon";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
  pointsMm: Array<{ x: number; y: number }>;
}

/**
 * One edge of a closed contour. The segment's start point is the previous
 * segment's `to` (the contour's `start` for the first segment); the loop closes
 * from the last segment's `to` back to `start`.
 */
export type PcbOutlineSegment =
  | { type: "line"; to: PcbPointMm }
  | { type: "arc"; to: PcbPointMm; centerMm: PcbPointMm; cw: boolean };

/**
 * Arc-aware free-form closed outline — the result of polygon drawing, fillet /
 * chamfer edits, and DXF / SVG import. Arcs are preserved (not flattened) so
 * Gerber / fabrication keep true curves.
 */
export interface PcbBoardContour {
  kind: "contour";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
  start: PcbPointMm;
  segments: PcbOutlineSegment[];
}

/**
 * A closed shape representing a single internal cutout (slot, window, internal
 * milling). Cutouts are punched out of the board substrate and exported as
 * additional closed Edge.Cuts contours. Reuses the non-rect outline shapes.
 */
export type PcbBoardCutoutShape =
  | PcbBoardOutlineRoundRect
  | PcbBoardOutlineCircle
  | PcbBoardContour;

export interface PcbBoardCutout {
  id: string;
  shape: PcbBoardCutoutShape;
}

export interface PcbDesignRules {
  clearance: {
    traceToTraceMm: number;
    traceToPadMm: number;
    padToPadMm: number;
    traceToViaMm: number;
    viaToViaMm: number;
    copperToBoardEdgeMm: number;
  };
  minimums: {
    traceWidthMm: number;
    drillSizeMm: number;
    annularRingMm: number;
    viaDiameterMm: number;
    viaDrillMm: number;
    /**
     * Minimum edge-to-edge spacing between drilled holes (mm). Optional/additive
     * — readers default to 0.25 mm (IPC-2222 / typical fab). Drives the
     * hole-to-hole DRC check.
     */
    holeToHoleMm?: number;
  };
}

export interface PcbNetClass {
  id: string;
  name: string;
  traceWidthMm: number;
  clearanceMm: number;
  viaDiameterMm: number;
  viaDrillMm: number;
  /** Color used to render ratsnest airwires for nets in this class. */
  color: string;
  /** IPC-4761 default applied to new vias on nets in this class. */
  defaultViaProtection: PcbViaProtection;
}

export interface PcbBoardSettings {
  outline: PcbBoardOutline;
  /**
   * Internal cutouts punched out of the board. Optional for back-compat with
   * pre-cutout saves; readers must treat an absent field as an empty list.
   */
  cutouts?: PcbBoardCutout[];
  activeLayer: PcbLayerId;
  visibleLayers: PcbLayerId[];
  designRules: PcbDesignRules;
  netClasses: PcbNetClass[];
  /**
   * Explicit per-net → net-class overrides (netId → netClassId). Consulted
   * before the name-pattern heuristic in `resolveNetClassId`, and applied to
   * new traces/vias at creation. Optional/additive — readers treat an absent
   * field as no overrides. Unknown class ids are dropped on persist.
   */
  perNetClassAssignments?: Record<string, string>;
  /**
   * Board-level trace-width presets (mm), shown in the route-tool dropdown
   * and cycled with W / Shift+W. The active net class's traceWidthMm is the
   * implicit default at session start.
   */
  tracePresets: number[];
  /**
   * Manufacturer preset for fab-rule validation. `"custom"` = user-defined
   * design rules only. Otherwise validation surfaces warnings when traces /
   * vias fall below the named fab's minimums (see `fab-presets.ts`).
   */
  fabricator: PcbFabricatorId;
  /**
   * Stackup layer count. Controls whether In1.Cu / In2.Cu are routable and
   * appear in the layer panel.
   */
  layerCount: PcbLayerCount;
  /**
   * Finished board thickness (mm). Optional/additive — readers default to
   * 1.6 mm (standard FR4). Drives the via aspect-ratio DRC check
   * (thickness / drill ≤ fab max).
   */
  boardThicknessMm?: number;
  /** Non-active layer emphasis cycle (Normal/Dim/Solo). Default `normal`. */
  displayMode: PcbDisplayMode;
  /**
   * Solder-mask aperture expansion (mm, per side). IPC-7351 typ. 0.05–0.075
   * SMD, 0.10 THT. Board-global v1; per-pad override deferred.
   */
  solderMaskExpansionMm: number;
  /**
   * Solder-paste aperture inset (mm, per side). Negative = aperture smaller
   * than pad. Typical −0.05 mm. Affects SMD pads only (THT skipped).
   */
  solderPasteExpansionMm: number;
  /**
   * Per-design display state (view-side, fill toggles, presets, opacities…).
   * Optional for backward-compat with pre-viewState saves; readers must
   * apply a default fallback when this field is absent.
   */
  viewState?: PcbViewState;
  updatedAt: string;
}

/**
 * Identifiers must match keys of `FAB_PRESETS` in
 * `src/modules/designer/backend/pcb/fab-presets.ts`.
 */
export type PcbFabricatorId =
  | "custom"
  | "jlcpcb_2l"
  | "jlcpcb_4l"
  | "pcbway_std"
  | "pcbway_advanced";

export interface PcbPlacedPart {
  id: string;
  partId: string;
  componentId: string;
  reference: string;
  positionMm: PcbPointMm;
  rotationDeg: number;
  mirrored: boolean;
  layer: PcbLayerId;
  footprint: LibraryFootprintPlacementSnapshot;
}

export interface PcbTrace {
  id: string;
  /** Net id resolved at create time from the starting pad, or null for empty-space starts. */
  netId: string | null;
  netClassId: string;
  layer: PcbCopperLayerId;
  /** Width in mm. Defaults from net class; user may override mid-route. */
  widthMm: number;
  /** Polyline in nm; >=2 points; segments are 90° or 45° depending on segmentMode. */
  pointsNm: Array<{ x: number; y: number }>;
  segmentMode: PcbTraceSegmentMode;
  /**
   * Optional hint emitted by importers (KiCad) carrying the source net name.
   * The projection net-pad correlator uses this to bind `netId` when pad
   * endpoint alignment is ambiguous (via-to-via, label-routed segments).
   * Native traces created via the route tool leave this null.
   */
  netName?: string | null;
}

/**
 * IPC-4761 via protection (tenting / fill / cap).
 *  - `tented`: solder mask covers via opening (default; cheapest).
 *  - `none`:   open via, accessible for test probes.
 *  - `plugged` / `filled`: non-conductive epoxy fill (Type III–VI).
 *  - `capped`:  filled + plated copper cap (Type VII; required for via-in-pad).
 */
export type PcbViaProtection =
  | "none"
  | "tented"
  | "plugged"
  | "filled"
  | "capped";

/**
 * Via topology. v1 ships only `through`; the schema is forward-compat for HDI
 * (blind/buried/microvia) when inner layers land in Phase C.
 */
export type PcbViaType = "through" | "blind" | "buried" | "micro";

/**
 * Origin of the via:
 *  - `route`  : dropped by the routing tool as part of a trace path (default).
 *  - `manual` : placed standalone by the user — stitching via, test point,
 *               isolated drop. v1 ships data-only; full manual-via tooling
 *               lives behind the F5 toolbar work-stream.
 */
export type PcbViaProvenance = "route" | "manual";

export interface PcbVia {
  id: string;
  netId: string | null;
  netClassId: string;
  centerMm: PcbPointMm;
  diameterMm: number;
  drillMm: number;
  /** Start copper layer of the via barrel. v1 = F.Cu (or B.Cu). */
  fromLayer: PcbCopperLayerId;
  /** End copper layer. v1 = B.Cu (or F.Cu). */
  toLayer: PcbCopperLayerId;
  viaType: PcbViaType;
  protection: PcbViaProtection;
  /** Defaults to `"route"` for legacy / pre-F5 rows. */
  provenance: PcbViaProvenance;
  /**
   * Optional importer hint — see PcbTrace.netName. Used by the projection
   * correlator to resolve `netId` when via geometry doesn't directly
   * intersect a pad.
   */
  netName?: string | null;
}

/**
 * Free-standing mechanical hole — drilled non-electrical opening that is not
 * part of any footprint. Used for mounting holes, tooling holes, alignment
 * cutouts, etc. Renders as a real cutout in the board substrate plus a lime
 * outline ring (shared rendering path with via / pad drills).
 *
 * Free holes are invisible to nets, ratsnest, and electrical DRC. Mechanical
 * DRC (drill-to-trace clearance) is applied separately via the design rules.
 */
/**
 * Oblong / slotted drill. When present on a free hole/pad, the drill is a
 * rounded slot (e.g. USB shield, edge connector) rather than a round hole:
 * Excellon emits it as a `G85` routed slot (tool diameter = `widthMm`) instead
 * of a single round hit. `lengthMm` is the overall long dimension along
 * `angleDeg` (0 = +X); `lengthMm === widthMm` degenerates to a round hole.
 */
export interface PcbDrillSlot {
  lengthMm: number;
  widthMm: number;
  angleDeg: number;
}

export interface PcbFreeHole {
  id: string;
  centerMm: PcbPointMm;
  drillMm: number;
  /** Oblong drill. When set, the hole is a routed slot of width `drillMm`. */
  drillSlot?: PcbDrillSlot | null;
  /** When true, the hole is read-only in the editor until unlocked. */
  lockedAt: string | null;
}

/**
 * Copper-pour zone (mostly imported from KiCad). v1 stores the outline polygon
 * + net name + layer; fill recomputation and DRC participation are deferred to
 * a later iteration. Rendered as a faint outline + net-color ghost so the
 * design intent stays visible after import.
 */
export interface PcbZone {
  id: string;
  /**
   * Source net name (e.g. "GND"). Resolved to `netId` at projection time by
   * the same name-binding pass that handles `PcbTrace.netName`.
   */
  netName: string | null;
  layer: PcbCopperLayerId;
  /** Closed polyline (last point implicitly connects back to first). */
  polygonPointsMm: Array<{ x: number; y: number }>;
  /** Hatch edge spacing for hatched fills; mm. */
  hatchEdgeMm: number;
  fillType: "solid" | "hatched";
}

/**
 * Layer a free overlay primitive may live on. Restricts to non-copper layers
 * so overlay graphics don't accidentally pollute electrical net extraction.
 */
export type PcbOverlayLayer =
  | "F.SilkS"
  | "B.SilkS"
  | "F.Fab"
  | "B.Fab"
  | "F.CrtYd"
  | "B.CrtYd"
  | "Edge.Cuts";

/**
 * Free-standing silkscreen / fab text. Anchored at a position with a font
 * size + rotation. The renderer falls back to the canvas EDA text primitive.
 */
export interface PcbOverlayText {
  id: string;
  layer: PcbOverlayLayer;
  positionMm: PcbPointMm;
  text: string;
  fontSizeMm: number;
  rotationDeg: number;
  mirror: boolean;
  /** Horizontal anchor. */
  justify: "left" | "center" | "right";
  lockedAt: string | null;
}

/**
 * Free-standing overlay shape — rectangle, circle, line, polyline, polygon.
 * Geometry lives in `points` (interpretation depends on `kind`):
 *  - rect:     [bottomLeft, topRight]
 *  - circle:   [center, edgePoint]  — radius = distance(center, edgePoint)
 *  - line / polyline / polygon: ordered vertices
 */
export type PcbOverlayShapeKind =
  | "rect"
  | "circle"
  | "line"
  | "polyline"
  | "polygon";

export interface PcbOverlayShape {
  id: string;
  layer: PcbOverlayLayer;
  kind: PcbOverlayShapeKind;
  pointsMm: PcbPointMm[];
  strokeWidthMm: number;
  /** Fill applies only to closed shapes (rect, circle, polygon). */
  fill: "none" | "solid";
  lockedAt: string | null;
}

/**
 * Free pad type. Drives which fields are valid + how the pad renders:
 *  - `smd`  : surface-mount, single layer, no drill.
 *  - `hole` : non-plated through-hole (NPTH) — drill only, no copper.
 *  - `std`  : standard plated through-hole — drill + annular copper on both sides.
 *  - `conn` : connector / large-area paddle pad (no drill, can be polygon).
 */
export type PcbFreePadType = "smd" | "hole" | "std" | "conn";

/**
 * Free pad shape. Matches the existing footprint pad shape enum so the
 * renderer can route through `PadInstances` without special-casing.
 */
export type PcbFreePadShape = "rect" | "circle" | "oval" | "roundrect";

/**
 * Free-standing electrical pad — not part of any footprint. Test point,
 * fiducial, paddle, manually placed pad. Optionally net-assigned so the
 * ratsnest and DRC see it as part of a net.
 */
export interface PcbFreePad {
  id: string;
  centerMm: PcbPointMm;
  rotationDeg: number;
  padType: PcbFreePadType;
  shape: PcbFreePadShape;
  widthMm: number;
  heightMm: number;
  /** Corner radius ratio for roundrect (0..0.5). Ignored for other shapes. */
  roundrectRatio?: number;
  /** Required for `hole` and `std`. Ignored / undefined otherwise. */
  drillMm: number | null;
  /** Oblong drill for `hole`/`std` pads. When set, the drill is a routed slot of width `drillMm`. */
  drillSlot?: PcbDrillSlot | null;
  /** Copper layer the pad lives on. `std` pads span F.Cu + B.Cu and only set this for fab-order purposes. */
  layer: PcbCopperLayerId;
  /** Net assignment. `null` = isolated pad. */
  netId: string | null;
  /** Optional mask expansion override (mm). `null` means use design rule. */
  solderMaskExpansionMm: number | null;
  /** Optional paste expansion override (mm). */
  solderPasteExpansionMm: number | null;
  lockedAt: string | null;
}

export interface RatsnestSegment {
  netId: string;
  /** Net-class id used for color routing (e.g. "default", "power", "gnd"). */
  netClassId: string;
  fromMm: PcbPointMm;
  toMm: PcbPointMm;
  fromPlacementId: string;
  fromPadNumber: string;
  toPlacementId: string;
  toPadNumber: string;
}

export interface DesignerPcbProjection {
  designId: string;
  revision: number;
  board: PcbBoardSettings;
  placements: PcbPlacedPart[];
  traces: PcbTrace[];
  vias: PcbVia[];
  /** Free-standing mechanical holes (mounting / tooling). Non-electrical. */
  freeHoles: PcbFreeHole[];
  /** Free-standing electrical pads (test points, paddles, fiducials). */
  freePads: PcbFreePad[];
  /** Silkscreen / fab text and shape primitives (F5 overlay layer). */
  overlayTexts: PcbOverlayText[];
  overlayShapes: PcbOverlayShape[];
  /** Copper-pour zones imported from KiCad (v1: outline only, no fill). */
  zones: PcbZone[];
  ratsnest: RatsnestSegment[];
  /**
   * Net id → display name map (e.g. `"net-7" → "VCC_3V3"`). Sourced from the
   * schematic's derived nets at projection time. Used by canvas overlays
   * (net-trace labels) and tooltips.
   */
  netNames: Record<string, string>;
  /**
   * Footprint-pad → net id map, key `` `${placementId}|${padNumber}` ``.
   * Derived from the schematic↔PCB pad correlation already computed at
   * projection time. Lets a pure consumer (DRC) resolve which net a footprint
   * pad belongs to without re-running correlation. Optional / additive: absent
   * on pre-DRC saves and when there is no schematic.
   */
  padNets?: Record<string, string>;
  warnings: string[];
}

export interface DesignerJunction {
  xNm: number;
  yNm: number;
}

export interface DesignerDerivedNet {
  id: string;
  name: string;
  pinIds: string[];
  wireIds: string[];
  labelIds: string[];
  primitiveIds: string[];
}

export interface DesignerPin {
  id: string;
  originPinKey: string;
  number: string | null;
  name: string;
  electricalType: string;
  unit: number;
  localPositionNm: {
    x: number;
    y: number;
  };
  worldPositionNm: {
    x: number;
    y: number;
  };
}

export interface PartPropertiesJson {
  valueStructured?: {
    kind: "resistor" | "capacitor" | "generic";
    amount?: number;
    unit?: string;
    tolerance?: string;
  };
  pcb?: {
    staleReason?: string;
    staleAt?: string;
  };
  [key: string]: unknown;
}

export interface DesignerPlacedPart {
  id: string;
  componentId: string;
  reference: string;
  value: string;
  rotationDeg: number;
  mirrored: boolean;
  positionNm: {
    x: number;
    y: number;
  };
  symbol: LibrarySymbolPlacementSnapshot;
  footprint: LibraryFootprintPlacementSnapshot;
  pins: DesignerPin[];
  propertiesJson: PartPropertiesJson;
}

export interface DesignerWire {
  id: string;
  sourcePinId: string;
  targetPinId: string;
  pointsNm: Array<{
    x: number;
    y: number;
  }>;
}

export interface DesignerLabel {
  id: string;
  text: string;
  positionNm: {
    x: number;
    y: number;
  };
}

interface DesignerPrimitiveBase {
  id: string;
  positionNm: { x: number; y: number };
  rotationDeg: number;
}

export interface DesignerGndPort extends DesignerPrimitiveBase {
  kind: "gnd";
}

export interface DesignerPwrPort extends DesignerPrimitiveBase {
  kind: "pwr";
  /** User-facing rail name (e.g. "VCC", "+3V3"). Drives the net's name. */
  railText: string;
}

export interface DesignerNetPortal extends DesignerPrimitiveBase {
  kind: "net_portal";
  /** Cross-region join key. Portals sharing this text merge into one net. */
  portalText: string;
}

export type DesignerPrimitive =
  | DesignerGndPort
  | DesignerPwrPort
  | DesignerNetPortal;

export interface DesignerPlacePartCommand {
  type: "place_part";
  componentId: string;
  positionNm: {
    x: number;
    y: number;
  };
  rotationDeg?: number;
  mirrored?: boolean;
}

export interface DesignerCreateWireCommand {
  type: "create_wire";
  sourcePinId: string;
  targetPinId: string;
  pointsNm?: Array<{
    x: number;
    y: number;
  }>;
}

export interface DesignerCreateWireJunctionCommand {
  type: "create_wire_junction";
  sourcePinId: string;
  wireId: string;
  targetPointNm: {
    x: number;
    y: number;
  };
  pointsNm?: Array<{
    x: number;
    y: number;
  }>;
}

export interface DesignerMovePartCommand {
  type: "move_part";
  partId: string;
  positionNm: {
    x: number;
    y: number;
  };
}

export interface DesignerRotatePartCommand {
  type: "rotate_part";
  partId: string;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface DesignerMirrorPartCommand {
  type: "mirror_part";
  partId: string;
  mirrored: boolean;
}

export interface DesignerUpdatePartPropertiesCommand {
  type: "update_part_properties";
  partId: string;
  reference?: string;
  value?: string;
  propertiesJson?: PartPropertiesJson;
}

export interface DesignerUpdatePartsPropertiesCommand {
  type: "update_parts_properties";
  partIds: string[];
  value?: string;
  propertiesJson?: PartPropertiesJson;
}

export interface DesignerDeleteEntityCommand {
  type: "delete_entity";
  entityId: string;
  entityKind: DesignerEntityKind;
}

export interface DesignerUpsertLabelCommand {
  type: "upsert_label";
  labelId?: string;
  text: string;
  positionNm: {
    x: number;
    y: number;
  };
}

export interface DesignerPlaceGndPortCommand {
  type: "place_gnd_port";
  positionNm: { x: number; y: number };
  rotationDeg?: 0 | 90 | 180 | 270;
}

export interface DesignerPlacePwrPortCommand {
  type: "place_pwr_port";
  positionNm: { x: number; y: number };
  rotationDeg?: 0 | 90 | 180 | 270;
  railText: string;
}

export interface DesignerPlaceNetPortalCommand {
  type: "place_net_portal";
  positionNm: { x: number; y: number };
  rotationDeg?: 0 | 90 | 180 | 270;
  portalText: string;
}

export interface DesignerMovePrimitiveCommand {
  type: "move_primitive";
  primitiveId: string;
  positionNm: { x: number; y: number };
}

export interface DesignerRotatePrimitiveCommand {
  type: "rotate_primitive";
  primitiveId: string;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface DesignerUpdatePrimitiveTextCommand {
  type: "update_primitive_text";
  primitiveId: string;
  /** Applies to railText (pwr) or portalText (net_portal). Ignored for gnd. */
  text: string;
}

/**
 * Re-layout the whole schematic deterministically from the netlist: group
 * net-connected parts into blocks with routing channels, then re-route every
 * wire around bodies / primitives / other wires. Non-destructive; one undo
 * step. Intended to be appended by AI placement/wiring proposals — manual
 * `move_part` never triggers it, so hand-placed layouts are not reshuffled.
 */
export interface DesignerAutoArrangeSchematicCommand {
  type: "auto_arrange_schematic";
  /** Optional top-left anchor for the layout. Defaults to the origin. */
  originNm?: { x: number; y: number };
  /** Reserved for a future selection-scoped arrange. v1 always re-lays all. */
  scope?: "all";
}

export interface DesignerPcbSetBoardSettingsCommand {
  type: "pcb_set_board_settings";
  widthMm: number;
  heightMm: number;
  /** Optional new board center. When omitted, the existing center is kept
   * (symmetric resize). Set by drag-resize to keep the opposite edge fixed. */
  centerMm?: PcbPointMm;
}

/**
 * General board-geometry command — sets the full outline shape (any kind) and,
 * optionally, the internal cutouts. Used by the shape picker, drag handles for
 * non-rect shapes, the polygon draw tool, import, and templates. The legacy
 * `pcb_set_board_settings` remains for the simple rect width/height path.
 */
export interface DesignerPcbSetBoardOutlineCommand {
  type: "pcb_set_board_outline";
  outline: PcbBoardOutline;
  /** When omitted, existing cutouts are kept; pass `[]` to clear them. */
  cutouts?: PcbBoardCutout[];
}

export interface DesignerPcbMovePlacementCommand {
  type: "pcb_move_placement";
  placementId: string;
  positionMm: PcbPointMm;
}

export interface DesignerPcbMovePlacementsCommand {
  type: "pcb_move_placements";
  updates: ReadonlyArray<{ placementId: string; positionMm: PcbPointMm }>;
}

export interface DesignerPcbRotatePlacementCommand {
  type: "pcb_rotate_placement";
  placementId: string;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface DesignerPcbFlipPlacementCommand {
  type: "pcb_flip_placement";
  placementId: string;
}

export interface DesignerPcbFlipPlacementsCommand {
  type: "pcb_flip_placements";
  placementIds: ReadonlyArray<string>;
}

export interface DesignerPcbSetActiveLayerCommand {
  type: "pcb_set_active_layer";
  layer: PcbLayerId;
}

export interface DesignerPcbSetVisibleLayersCommand {
  type: "pcb_set_visible_layers";
  visibleLayers: ReadonlyArray<PcbLayerId>;
}

export interface DesignerPcbAddTraceCommand {
  type: "pcb_add_trace";
  layer: PcbCopperLayerId;
  pointsNm: Array<{ x: number; y: number }>;
  widthMm: number;
  netId: string | null;
  netClassId: string;
  segmentMode: PcbTraceSegmentMode;
}

export interface DesignerPcbAddViaCommand {
  type: "pcb_add_via";
  centerMm: PcbPointMm;
  netId: string | null;
  netClassId: string;
  /** Optional override for via diameter; falls back to net-class default. */
  diameterMmOverride?: number;
  /** Optional override for via drill; falls back to net-class default. */
  drillMmOverride?: number;
}

export interface DesignerPcbAddTraceViaCommand {
  type: "pcb_add_trace_via";
  trace: Omit<DesignerPcbAddTraceCommand, "type">;
  via: Omit<DesignerPcbAddViaCommand, "type">;
}

export interface DesignerPcbDeleteTraceCommand {
  type: "pcb_delete_trace";
  traceId: string;
}

export interface DesignerPcbDeleteViaCommand {
  type: "pcb_delete_via";
  viaId: string;
}

export interface DesignerPcbUpdateTraceGeometryCommand {
  type: "pcb_update_trace_geometry";
  traceId: string;
  pointsNm: Array<{ x: number; y: number }>;
}

/**
 * Replace the per-design display state (viewSide / displayMode / preset / fill
 * toggles / opacities). Front-end debounces ~200ms so slider drags don't
 * spam undo history. The command persists straight into
 * `PcbBoardSettings.viewState`; partial updates merge into existing state.
 */
export interface DesignerPcbSetViewStateCommand {
  type: "pcb_set_view_state";
  patch: Partial<PcbViewState>;
}

/**
 * Edit the board's design rules, net classes, and/or finished thickness.
 * Non-undoable settings change; bumps the revision so a prior DRC run is
 * marked stale. Any omitted field is left unchanged.
 */
export interface DesignerPcbSetDesignRulesCommand {
  type: "pcb_set_design_rules";
  designRules?: PcbDesignRules;
  netClasses?: PcbNetClass[];
  boardThicknessMm?: number;
  /** Per-net → net-class overrides (netId → netClassId). See PcbBoardSettings. */
  perNetClassAssignments?: Record<string, string>;
}

/**
 * Delete a placement (component) from the PCB. Schematic-side reference is
 * unaffected — auto-sync will re-create the placement on next projection
 * unless the schematic part is also removed.
 */
export interface DesignerPcbDeletePlacementCommand {
  type: "pcb_delete_placement";
  placementId: string;
}

export interface DesignerPcbAddFreeHoleCommand {
  type: "pcb_add_free_hole";
  centerMm: PcbPointMm;
  drillMm: number;
}

export interface DesignerPcbUpdateFreeHoleCommand {
  type: "pcb_update_free_hole";
  freeHoleId: string;
  /** Optional patch — only provided fields are updated. */
  centerMm?: PcbPointMm;
  drillMm?: number;
  /** Pass `true` to lock, `false` to unlock, omit to leave unchanged. */
  locked?: boolean;
}

export interface DesignerPcbDeleteFreeHoleCommand {
  type: "pcb_delete_free_hole";
  freeHoleId: string;
}

export interface DesignerPcbAddFreePadCommand {
  type: "pcb_add_free_pad";
  centerMm: PcbPointMm;
  rotationDeg: number;
  padType: PcbFreePadType;
  shape: PcbFreePadShape;
  widthMm: number;
  heightMm: number;
  roundrectRatio?: number;
  drillMm?: number;
  layer: PcbCopperLayerId;
  netId?: string | null;
  solderMaskExpansionMm?: number;
  solderPasteExpansionMm?: number;
}

export interface DesignerPcbUpdateFreePadCommand {
  type: "pcb_update_free_pad";
  freePadId: string;
  centerMm?: PcbPointMm;
  rotationDeg?: number;
  padType?: PcbFreePadType;
  shape?: PcbFreePadShape;
  widthMm?: number;
  heightMm?: number;
  roundrectRatio?: number;
  drillMm?: number | null;
  layer?: PcbCopperLayerId;
  netId?: string | null;
  solderMaskExpansionMm?: number | null;
  solderPasteExpansionMm?: number | null;
  locked?: boolean;
}

export interface DesignerPcbDeleteFreePadCommand {
  type: "pcb_delete_free_pad";
  freePadId: string;
}

/**
 * Drop a manually placed via (smart via) — not associated with any routed
 * trace. Use cases: stitching vias to a copper pour, test-point vias, edge
 * fiducials. Diameter / drill default to the net-class spec when omitted.
 *
 * The persisted via carries `provenance: "manual"` so future tooling can
 * distinguish route-dropped vs hand-placed.
 */
export interface DesignerPcbAddManualViaCommand {
  type: "pcb_add_manual_via";
  centerMm: PcbPointMm;
  netId: string | null;
  netClassId: string;
  diameterMmOverride?: number;
  drillMmOverride?: number;
}

export interface DesignerPcbAddOverlayTextCommand {
  type: "pcb_add_overlay_text";
  layer: PcbOverlayLayer;
  positionMm: PcbPointMm;
  text: string;
  fontSizeMm: number;
  rotationDeg: number;
  mirror?: boolean;
  justify?: "left" | "center" | "right";
}

export interface DesignerPcbUpdateOverlayTextCommand {
  type: "pcb_update_overlay_text";
  overlayTextId: string;
  layer?: PcbOverlayLayer;
  positionMm?: PcbPointMm;
  text?: string;
  fontSizeMm?: number;
  rotationDeg?: number;
  mirror?: boolean;
  justify?: "left" | "center" | "right";
  locked?: boolean;
}

export interface DesignerPcbDeleteOverlayTextCommand {
  type: "pcb_delete_overlay_text";
  overlayTextId: string;
}

export interface DesignerPcbAddOverlayShapeCommand {
  type: "pcb_add_overlay_shape";
  layer: PcbOverlayLayer;
  kind: PcbOverlayShapeKind;
  pointsMm: PcbPointMm[];
  strokeWidthMm: number;
  fill?: "none" | "solid";
}

export interface DesignerPcbUpdateOverlayShapeCommand {
  type: "pcb_update_overlay_shape";
  overlayShapeId: string;
  layer?: PcbOverlayLayer;
  kind?: PcbOverlayShapeKind;
  pointsMm?: PcbPointMm[];
  strokeWidthMm?: number;
  fill?: "none" | "solid";
  locked?: boolean;
}

export interface DesignerPcbDeleteOverlayShapeCommand {
  type: "pcb_delete_overlay_shape";
  overlayShapeId: string;
}

export type DesignerCommand =
  | DesignerPlacePartCommand
  | DesignerCreateWireCommand
  | DesignerCreateWireJunctionCommand
  | DesignerMovePartCommand
  | DesignerRotatePartCommand
  | DesignerMirrorPartCommand
  | DesignerUpdatePartPropertiesCommand
  | DesignerUpdatePartsPropertiesCommand
  | DesignerDeleteEntityCommand
  | DesignerUpsertLabelCommand
  | DesignerPlaceGndPortCommand
  | DesignerPlacePwrPortCommand
  | DesignerPlaceNetPortalCommand
  | DesignerMovePrimitiveCommand
  | DesignerRotatePrimitiveCommand
  | DesignerUpdatePrimitiveTextCommand
  | DesignerAutoArrangeSchematicCommand
  | DesignerPcbSetBoardSettingsCommand
  | DesignerPcbSetBoardOutlineCommand
  | DesignerPcbMovePlacementCommand
  | DesignerPcbMovePlacementsCommand
  | DesignerPcbRotatePlacementCommand
  | DesignerPcbFlipPlacementCommand
  | DesignerPcbFlipPlacementsCommand
  | DesignerPcbSetActiveLayerCommand
  | DesignerPcbSetVisibleLayersCommand
  | DesignerPcbAddTraceCommand
  | DesignerPcbAddViaCommand
  | DesignerPcbAddTraceViaCommand
  | DesignerPcbDeleteTraceCommand
  | DesignerPcbDeleteViaCommand
  | DesignerPcbUpdateTraceGeometryCommand
  | DesignerPcbSetViewStateCommand
  | DesignerPcbSetDesignRulesCommand
  | DesignerPcbDeletePlacementCommand
  | DesignerPcbAddFreeHoleCommand
  | DesignerPcbUpdateFreeHoleCommand
  | DesignerPcbDeleteFreeHoleCommand
  | DesignerPcbAddFreePadCommand
  | DesignerPcbUpdateFreePadCommand
  | DesignerPcbDeleteFreePadCommand
  | DesignerPcbAddManualViaCommand
  | DesignerPcbAddOverlayTextCommand
  | DesignerPcbUpdateOverlayTextCommand
  | DesignerPcbDeleteOverlayTextCommand
  | DesignerPcbAddOverlayShapeCommand
  | DesignerPcbUpdateOverlayShapeCommand
  | DesignerPcbDeleteOverlayShapeCommand;

export type DesignerCommandEnvelope = CommandEnvelope<DesignerCommand>;

export interface DesignerHistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
}

export interface DesignerHistoryActionOkResult {
  ok: true;
  revision: number;
  history: DesignerHistorySnapshot;
}

export type DesignerHistoryActionResult =
  | DesignerHistoryActionOkResult
  | {
      ok: false;
      code: "HISTORY_EMPTY";
      direction: "undo" | "redo";
      history: DesignerHistorySnapshot;
    };

export interface DesignerCommandOkResult {
  ok: true;
  revision: number;
  createdEntityId: string | null;
  idempotent?: boolean;
}

export type DesignerDispatchResult =
  | DesignerCommandOkResult
  | {
      ok: false;
      code: "REVISION_CONFLICT";
      conflict: {
        expected: number | null;
        actual: number;
      };
    }
  | {
      ok: false;
      code: "COMPONENT_NOT_FOUND";
      componentId: string;
    }
  | {
      ok: false;
      code: "COMPONENT_NOT_WIREABLE";
      componentId: string;
      reason: "NO_PINS";
    }
  | {
      ok: false;
      code: "PIN_NOT_FOUND";
      pinId: string;
    }
  | {
      ok: false;
      code: "ENTITY_NOT_FOUND";
      entityId: string;
      entityKind: DesignerEntityKind;
    }
  | {
      ok: false;
      code: "INVALID_WIRE_PATH";
      detail: string;
    }
  | {
      ok: false;
      code: "DUPLICATE_REFERENCE";
      reference: string;
    }
  | {
      ok: false;
      code: "INVALID_LABEL";
      detail: string;
    }
  | {
      ok: false;
      code: "INVALID_PRIMITIVE";
      detail: string;
    }
  | {
      ok: false;
      code: "PRIMITIVE_NOT_FOUND";
      primitiveId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_BOARD_SETTINGS";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_PLACEMENT_NOT_FOUND";
      placementId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_TRACE";
      detail: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_VIA";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_TRACE_NOT_FOUND";
      traceId: string;
    }
  | {
      ok: false;
      code: "PCB_VIA_NOT_FOUND";
      viaId: string;
    }
  | {
      ok: false;
      code: "PCB_NET_CLASS_NOT_FOUND";
      netClassId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_FREE_HOLE";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_FREE_HOLE_NOT_FOUND";
      freeHoleId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_FREE_PAD";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_FREE_PAD_NOT_FOUND";
      freePadId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_OVERLAY";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_OVERLAY_NOT_FOUND";
      overlayId: string;
    };

/**
 * Pointer to a specific design entity an ERC violation hangs off of. The
 * canvas uses these to jump-to-violation and to draw inline indicators.
 */
export type ErcAnchor =
  | { kind: "pin"; pinId: string }
  | { kind: "net"; netId: string }
  | { kind: "part"; partId: string };

export type ErcSeverity = "error" | "warning" | "info";

export interface ErcViolation {
  code: string;
  severity: ErcSeverity;
  message: string;
  anchors: ErcAnchor[];
}

export interface ErcReport {
  designId: string;
  revision: number;
  violations: ErcViolation[];
  summary: { errors: number; warnings: number; infos: number };
}

/**
 * Pointer to a specific PCB entity a DRC violation hangs off of. The canvas
 * uses these to highlight offending items; each violation also carries a
 * `locationMm` + `layer` for marker placement (KiCad-style: the marker sits at
 * the midpoint of the offending pair).
 */
export type DrcAnchor =
  | { kind: "trace"; traceId: string }
  | { kind: "segment"; traceId: string; index: number }
  | { kind: "via"; viaId: string }
  | { kind: "pad"; placementId: string; padNumber: string }
  | { kind: "freePad"; freePadId: string }
  | { kind: "freeHole"; freeHoleId: string }
  | { kind: "placement"; placementId: string }
  | { kind: "net"; netId: string }
  | { kind: "boardEdge" };

export type DrcSeverity = "error" | "warning" | "info";

/**
 * Rule-class groups violations in the panel and drives per-class ignore
 * toggles (`PcbViewState.drcIgnoredRuleClasses`).
 */
export type DrcRuleClass =
  | "clearance"
  | "constraint"
  | "connectivity"
  | "manufacturability"
  | "structural";

/**
 * Stable, machine-readable violation codes. P1 codes are implemented now; P2
 * codes are declared for forward-compat (panel grouping / i18n) and wired
 * later. See `src/modules/designer/backend/drc/`.
 */
export type DrcRuleCode =
  // --- P1 ---
  | "TRACE_WIDTH_MIN"
  | "VIA_DIAMETER_MIN"
  | "VIA_DRILL_MIN"
  | "DRILL_SIZE_MIN"
  | "ANNULAR_RING_MIN"
  | "TRACE_TO_TRACE_CLEARANCE"
  | "TRACE_TO_PAD_CLEARANCE"
  | "TRACE_TO_VIA_CLEARANCE"
  | "UNCONNECTED_NET"
  | "NET_SHORT_CIRCUIT"
  | "TRACE_LAYER_MISMATCH"
  | "PLACED_PART_MISSING_FOOTPRINT"
  | "FAB_TRACE_WIDTH"
  | "FAB_CLEARANCE"
  | "FAB_ANNULAR_RING"
  | "FAB_DRILL"
  | "FAB_PAD"
  // --- P2 (declared, not yet implemented) ---
  | "VIA_TO_VIA_CLEARANCE"
  | "PAD_TO_PAD_CLEARANCE"
  | "PAD_TO_VIA_CLEARANCE"
  | "COPPER_TO_BOARD_EDGE"
  | "HOLE_TO_HOLE"
  | "VIA_LAYER_SPAN"
  | "VIA_ASPECT_RATIO"
  | "BOARD_OUTLINE_INVALID"
  | "COPPER_OFF_BOARD";

export interface DrcViolation {
  /**
   * Stable id = hash(code + sorted anchor keys). Order-independent and stable
   * across re-runs so a persisted waiver keeps matching the same violation.
   */
  id: string;
  code: DrcRuleCode;
  ruleClass: DrcRuleClass;
  severity: DrcSeverity;
  message: string;
  anchors: DrcAnchor[];
  /** Marker placement (mm, board coords). Absent for non-spatial violations. */
  locationMm?: PcbPointMm;
  /** Copper layer the violation lives on, when layer-specific. */
  layer?: PcbCopperLayerId;
  /** Measured value that triggered the rule (mm). */
  measuredMm?: number;
  /** Required threshold from the rule (mm). */
  requiredMm?: number;
  /**
   * True when the user has waived this violation id. Waived violations are
   * still listed (panel shows them struck-through) but excluded from
   * `summary` counts.
   */
  waived?: boolean;
}

export interface DrcReport {
  designId: string;
  revision: number;
  violations: DrcViolation[];
  /** Active (non-waived) counts. Drives the status bar + panel badges. */
  summary: { errors: number; warnings: number; infos: number };
  /** Per-code counts of all emitted violations (incl. waived) for grouping. */
  countsByCode: Partial<Record<DrcRuleCode, number>>;
}

export interface DesignerSearchLibraryParams {
  query?: string;
  tags?: string[];
  limit?: number;
}

export interface DesignerDispatchContext {
  designId: string;
  envelope: DesignerCommandEnvelope;
}

export interface DesignerLibraryLookup {
  component: LibraryComponent;
  placement: LibraryComponentPlacementDetail;
}

// ─────────────────────── KiCad project import ───────────────────────

/**
 * Severity-tagged warning shared by the inspect + commit responses. A code is a
 * stable, machine-readable identifier (`zones_dropped`, `hierarchical_sheets_flattened`,
 * `wire_diagonal`, `footprint_missing_lib_id`, …). The message is user-facing
 * English suitable for the import wizard.
 */
export interface KicadProjectImportWarning {
  code: string;
  message: string;
  severity: "info" | "warning";
}

export interface KicadProjectInspectReport {
  /** Suggested OpenPCB design name (defaults to `.kicad_pro` basename). */
  projectName: string;
  /** Copper layer count derived from the .kicad_pcb (layers ...) block. */
  copperLayerCount: number;
  /** Schematic sheet count. v1 always reports 1 because hierarchical sheets are flattened. */
  schematicSheetCount: number;
  /** Number of net entries declared in the .kicad_pcb. */
  netCount: number;
  /** Bounding box of Edge.Cuts graphics in mm; `null` when no outline graphics found. */
  boardOutlineMm: {
    minXMm: number;
    minYMm: number;
    maxXMm: number;
    maxYMm: number;
  } | null;
  /** Per-component reuse/ingest status, keyed by `lib_id`. */
  components: KicadProjectImportComponentRow[];
  /** Counts of schematic and PCB entities found. */
  counts: KicadProjectImportCounts;
  /** Net classes declared in the project, with unknown rules preserved. */
  netClasses: KicadProjectImportNetClass[];
  warnings: KicadProjectImportWarning[];
}

export interface KicadProjectImportComponentRow {
  libId: string;
  /** All refdes instances of this lib_id in the project. */
  references: string[];
  /** Where this component will come from on commit. */
  status: "reuse" | "ingest" | "missing";
  /** When `status === "reuse"`, the OpenPCB componentId we matched to. */
  componentId: string | null;
  /** Reason free-form, populated when status === "missing". */
  reason?: string;
}

export interface KicadProjectImportCounts {
  schematicSymbols: number;
  schematicWires: number;
  schematicLabels: number;
  schematicGlobalLabels: number;
  schematicPowerSymbols: number;
  schematicJunctions: number;
  schematicNoConnects: number;
  hierarchicalSheets: number;
  pcbFootprints: number;
  pcbSegments: number;
  pcbVias: number;
  pcbZones: number;
}

export interface KicadProjectImportNetClass {
  name: string;
  clearanceMm: number | null;
  trackWidthMm: number | null;
  viaDiameterMm: number | null;
  viaDrillMm: number | null;
  /** Unknown / opaque rules (diff pair gap, microvia, uvia, …) preserved verbatim. */
  unknownRules: Record<string, unknown>;
}

export interface KicadProjectCommitRequest {
  /** Suggested design name; defaults to inspect report's projectName. */
  designName?: string;
  /** ZIP archive of the KiCad project bundle (bytes). Server resolves files internally. */
  archiveBytes: Uint8Array;
  archiveFileName: string;
}

export interface KicadProjectCommitResult {
  designId: string;
  designName: string;
  /** Summary of what was actually inserted. */
  applied: {
    boardOutline: boolean;
    copperLayerCount: number;
    netClassesIngested: number;
    /**
     * v1 deliberately does NOT yet ingest schematic parts / wires / PCB
     * placements (those require library-component ingestion of project-embedded
     * symbols and footprints). The list of deferred entity kinds is surfaced
     * here so the wizard can display "imported as empty design + N warnings"
     * cleanly.
     */
    deferred: KicadProjectDeferredEntityKind[];
  };
  warnings: KicadProjectImportWarning[];
}

export type KicadProjectDeferredEntityKind =
  | "schematic_symbols"
  | "schematic_wires"
  | "schematic_labels"
  | "schematic_primitives"
  | "pcb_placements"
  | "pcb_segments"
  | "pcb_vias"
  | "library_ingestion";

// =========================================================================
// Manufacturing export (Gerber X2 + Excellon + BOM + pick-and-place)
//
// First fab-able beta: ship a 2-layer board to JLCPCB/PCBWay using only
// OpenPCB output. RS-274X X2 only (no legacy mode).
// =========================================================================

export type GerberArtifactKind =
  | "gerber.top_copper"
  | "gerber.bottom_copper"
  | "gerber.inner1_copper"
  | "gerber.inner2_copper"
  | "gerber.top_mask"
  | "gerber.bottom_mask"
  | "gerber.top_paste"
  | "gerber.bottom_paste"
  | "gerber.top_silk"
  | "gerber.bottom_silk"
  | "gerber.edge_cuts"
  | "gerber.job"
  | "excellon.drills_pth"
  | "excellon.drills_npth"
  | "csv.bom"
  | "csv.pnp";

export interface GerberArtifact {
  kind: GerberArtifactKind;
  fileName: string;
  /** UTF-8 textual contents. All v0 artifacts are text. */
  text: string;
}

export interface GerberExportOptions {
  includeBom?: boolean;
  includePickAndPlace?: boolean;
  includeInnerLayers?: boolean;
}

export interface GerberExportRequest {
  designId: string;
  options?: GerberExportOptions;
}

export interface GerberExportResult {
  designId: string;
  bundleName: string;
  artifacts: GerberArtifact[];
  warnings: string[];
}

export interface BomRow {
  refdesList: string;
  value: string;
  footprint: string;
  partNumber: string | null;
  quantity: number;
  manufacturer?: string | null;
  manufacturerPartNumber?: string | null;
}

export interface BomOverride {
  designId: string;
  refdes: string;
  manufacturer: string | null;
  manufacturerPartNumber: string | null;
  lcscPartNumber: string | null;
  supplier: string | null;
  unitPrice: number | null;
  currency: string | null;
  dnp: boolean;
  assemblySide: "top" | "bottom" | null;
  notes: string | null;
  updatedAt: string;
}

export interface BomLineRef {
  refdes: string;
  partId: string | null;
  placementId: string | null;
  pcbLayer: "top" | "bottom" | null;
  dnp: boolean;
}

export interface BomLine {
  id: string;
  refs: BomLineRef[];
  refdesList: string;
  value: string;
  footprint: string;
  quantity: number;
  manufacturer: string | null;
  manufacturerPartNumber: string | null;
  lcscPartNumber: string | null;
  supplier: string | null;
  unitPrice: number | null;
  currency: string | null;
  dnp: boolean;
  assemblySide: "top" | "bottom" | "mixed" | null;
  notes: string | null;
  warnings: string[];
}

export interface BomSummary {
  lineCount: number;
  partCount: number;
  activePartCount: number;
  dnpPartCount: number;
  missingRequiredCount: number;
  estimatedCost: number | null;
  currency: string | null;
}

export interface BomProjection {
  designId: string;
  revision: number;
  rows: BomLine[];
  summary: BomSummary;
  warnings: string[];
}

export interface BomOverridePatch {
  manufacturer?: string | null;
  manufacturerPartNumber?: string | null;
  lcscPartNumber?: string | null;
  supplier?: string | null;
  unitPrice?: number | null;
  currency?: string | null;
  dnp?: boolean;
  assemblySide?: "top" | "bottom" | null;
  notes?: string | null;
}

export interface CentroidRow {
  refdes: string;
  value: string;
  footprint: string;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  layer: "top" | "bottom";
}
