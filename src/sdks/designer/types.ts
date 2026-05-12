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

export type PcbLayerId = "F.Cu" | "B.Cu" | "F.SilkS" | "B.SilkS" | "Edge.Cuts";

/** Subset of PcbLayerId that traces and vias may live on (copper only). */
export type PcbCopperLayerId = "F.Cu" | "B.Cu";

export type PcbTraceSegmentMode = "manhattan-90" | "manhattan-45";

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
  | DesignerPcbDeleteTraceCommand
  | DesignerPcbDeleteViaCommand
  | DesignerPcbUpdateTraceGeometryCommand;

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
    };

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
