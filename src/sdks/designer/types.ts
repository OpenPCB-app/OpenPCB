import type { CommandEnvelope } from "../../shared/domain/commands/command-envelope";
import type {
  LibraryComponent,
  LibraryComponentPlacementDetail,
  LibraryFootprintPlacementSnapshot,
  LibrarySymbolPlacementSnapshot,
} from "../library";

export type DesignerEntityKind = "part" | "wire" | "label";

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
  junctions: DesignerJunction[];
  nets: DesignerDerivedNet[];
}

export type PcbLayerId = "F.Cu" | "B.Cu" | "F.SilkS" | "B.SilkS" | "Edge.Cuts";

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
}

export interface PcbBoardSettings {
  outline: PcbBoardOutline;
  activeLayer: PcbLayerId;
  visibleLayers: PcbLayerId[];
  designRules: PcbDesignRules;
  netClasses: PcbNetClass[];
  updatedAt: string;
}

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
  ratsnest: RatsnestSegment[];
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

export interface DesignerPcbRotatePlacementCommand {
  type: "pcb_rotate_placement";
  placementId: string;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface DesignerPcbSetActiveLayerCommand {
  type: "pcb_set_active_layer";
  layer: PcbLayerId;
}

export type DesignerCommand =
  | DesignerPlacePartCommand
  | DesignerCreateWireCommand
  | DesignerCreateWireJunctionCommand
  | DesignerMovePartCommand
  | DesignerRotatePartCommand
  | DesignerMirrorPartCommand
  | DesignerDeleteEntityCommand
  | DesignerUpsertLabelCommand
  | DesignerPcbSetBoardSettingsCommand
  | DesignerPcbMovePlacementCommand
  | DesignerPcbRotatePlacementCommand
  | DesignerPcbSetActiveLayerCommand;

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
      code: "INVALID_LABEL";
      detail: string;
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
