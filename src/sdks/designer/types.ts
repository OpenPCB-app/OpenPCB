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

export interface DesignerDesignSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
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
}

export interface PcbPointMm {
  x: number;
  y: number;
}

export interface PcbBoardOutline {
  kind: "rect";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
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
  activeLayer: PcbLayerId;
  visibleLayers: PcbLayerId[];
  designRules: PcbDesignRules;
  netClasses: PcbNetClass[];
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
export interface PcbFreeHole {
  id: string;
  centerMm: PcbPointMm;
  drillMm: number;
  /** When true, the hole is read-only in the editor until unlocked. */
  lockedAt: string | null;
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
  ratsnest: RatsnestSegment[];
  /**
   * Net id → display name map (e.g. `"net-7" → "VCC_3V3"`). Sourced from the
   * schematic's derived nets at projection time. Used by canvas overlays
   * (net-trace labels) and tooltips.
   */
  netNames: Record<string, string>;
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

export interface DesignerPcbSetBoardSettingsCommand {
  type: "pcb_set_board_settings";
  widthMm: number;
  heightMm: number;
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
  | DesignerPcbSetBoardSettingsCommand
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
