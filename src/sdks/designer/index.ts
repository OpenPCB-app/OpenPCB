import type {
  CreateDesignerDesignInput,
  DesignerCommandEnvelope,
  DesignerDesignRecord,
  DesignerDesignSummary,
  DesignerDispatchResult,
  DesignerHistoryActionResult,
  DesignerHistorySnapshot,
  DesignerPcbProjection,
  DesignerSchematicProjection,
  DesignerSearchLibraryParams,
} from "./types";
import type {
  LibraryComponent,
  LibraryComponentPlacementDetail,
} from "../library";

export type {
  CreateDesignerDesignInput,
  DesignerCommand,
  DesignerCommandEnvelope,
  DesignerCommandOkResult,
  DesignerCreateWireCommand,
  DesignerCreateWireJunctionCommand,
  DesignerDeleteEntityCommand,
  DesignerDerivedNet,
  DesignerDesignRecord,
  DesignerDesignSummary,
  DesignerDispatchContext,
  DesignerDispatchResult,
  DesignerEntityKind,
  DesignerEntityRecord,
  DesignerHistoryActionOkResult,
  DesignerHistoryActionResult,
  DesignerHistorySnapshot,
  DesignerJunction,
  DesignerLabel,
  DesignerLibraryLookup,
  DesignerMirrorPartCommand,
  DesignerMovePartCommand,
  DesignerPin,
  PcbBoardOutline,
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbLayerId,
  PcbNetClass,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbTraceSegmentMode,
  PcbVia,
  RatsnestSegment,
  DesignerPcbProjection,
  DesignerPcbAddTraceCommand,
  DesignerPcbAddViaCommand,
  DesignerPcbDeleteTraceCommand,
  DesignerPcbDeleteViaCommand,
  DesignerPcbMovePlacementCommand,
  DesignerPcbRotatePlacementCommand,
  DesignerPcbSetActiveLayerCommand,
  DesignerPcbSetBoardSettingsCommand,
  DesignerPcbUpdateTraceGeometryCommand,
  DesignerPlacePartCommand,
  DesignerPlacedPart,
  DesignerRotatePartCommand,
  DesignerSchematicProjection,
  DesignerSearchLibraryParams,
  DesignerUpsertLabelCommand,
  DesignerWire,
} from "./types";
export type { DesignerInvalidatedEvent } from "./events";

export interface DesignerSDK {
  createDesign(
    input?: CreateDesignerDesignInput,
  ): Promise<DesignerDesignSummary>;
  listDesigns(): Promise<DesignerDesignSummary[]>;
  getDesign(designId: string): Promise<DesignerDesignRecord | null>;
  getSchematicProjection(
    designId: string,
  ): Promise<DesignerSchematicProjection | null>;
  getPcbProjection(designId: string): Promise<DesignerPcbProjection | null>;
  searchLibraryComponents(
    params: DesignerSearchLibraryParams,
  ): Promise<LibraryComponent[]>;
  resolveLibraryComponentForPlacement(
    componentId: string,
  ): Promise<LibraryComponentPlacementDetail | null>;
  dispatchCommand(
    designId: string,
    envelope: DesignerCommandEnvelope,
  ): Promise<DesignerDispatchResult>;
  getHistory(
    designId: string,
    sessionId: string,
  ): Promise<DesignerHistorySnapshot>;
  undo(
    designId: string,
    sessionId: string,
  ): Promise<DesignerHistoryActionResult>;
  redo(
    designId: string,
    sessionId: string,
  ): Promise<DesignerHistoryActionResult>;
}
