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
  ErcReport,
  UpdateDesignerDesignInput,
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
  PcbDisplayMode,
  PcbFabricatorId,
  PcbLayerCount,
  PcbLayerId,
  PcbLayerPreset,
  PcbViewSide,
  PcbViewState,
  PcbNetClass,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbTraceSegmentMode,
  PcbVia,
  PcbViaProtection,
  PcbViaType,
  PcbViaProvenance,
  PcbFreeHole,
  PcbFreePad,
  PcbFreePadShape,
  PcbFreePadType,
  PcbOverlayLayer,
  PcbOverlayShape,
  PcbOverlayShapeKind,
  PcbOverlayText,
  RatsnestSegment,
  DesignerPcbProjection,
  DesignerPcbAddTraceCommand,
  DesignerPcbAddTraceViaCommand,
  DesignerPcbAddViaCommand,
  DesignerPcbDeleteTraceCommand,
  DesignerPcbDeleteViaCommand,
  DesignerPcbFlipPlacementCommand,
  DesignerPcbFlipPlacementsCommand,
  DesignerPcbMovePlacementCommand,
  DesignerPcbMovePlacementsCommand,
  DesignerPcbRotatePlacementCommand,
  DesignerPcbSetActiveLayerCommand,
  DesignerPcbSetBoardSettingsCommand,
  DesignerPcbSetViewStateCommand,
  DesignerPcbSetVisibleLayersCommand,
  DesignerPcbUpdateTraceGeometryCommand,
  DesignerPcbDeletePlacementCommand,
  DesignerPcbAddFreeHoleCommand,
  DesignerPcbUpdateFreeHoleCommand,
  DesignerPcbDeleteFreeHoleCommand,
  DesignerPcbAddFreePadCommand,
  DesignerPcbUpdateFreePadCommand,
  DesignerPcbDeleteFreePadCommand,
  DesignerPcbAddManualViaCommand,
  DesignerPcbAddOverlayTextCommand,
  DesignerPcbUpdateOverlayTextCommand,
  DesignerPcbDeleteOverlayTextCommand,
  DesignerPcbAddOverlayShapeCommand,
  DesignerPcbUpdateOverlayShapeCommand,
  DesignerPcbDeleteOverlayShapeCommand,
  ErcAnchor,
  ErcReport,
  ErcSeverity,
  ErcViolation,
  DesignerPlacePartCommand,
  DesignerPlaceGndPortCommand,
  DesignerPlacePwrPortCommand,
  DesignerPlaceNetPortalCommand,
  DesignerMovePrimitiveCommand,
  DesignerRotatePrimitiveCommand,
  DesignerUpdatePrimitiveTextCommand,
  DesignerPlacedPart,
  DesignerPrimitive,
  DesignerPrimitiveKind,
  DesignerGndPort,
  DesignerPwrPort,
  DesignerNetPortal,
  DesignerRotatePartCommand,
  DesignerSchematicProjection,
  DesignerSearchLibraryParams,
  DesignerUpdatePartPropertiesCommand,
  DesignerUpdatePartsPropertiesCommand,
  DesignerUpsertLabelCommand,
  DesignerWire,
  UpdateDesignerDesignInput,
} from "./types";
export type { DesignerInvalidatedEvent } from "./events";
export { placementMirrorX } from "./pcb-helpers";

export interface DesignerSDK {
  createDesign(
    input?: CreateDesignerDesignInput,
  ): Promise<DesignerDesignSummary>;
  listDesigns(): Promise<DesignerDesignSummary[]>;
  getDesign(designId: string): Promise<DesignerDesignRecord | null>;
  updateDesign(
    designId: string,
    input: UpdateDesignerDesignInput,
  ): Promise<DesignerDesignSummary | null>;
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
  /** Run the ERC engine over the current schematic projection. Returns `null` when the design has no schematic projection (e.g. brand new design). */
  runErc(designId: string): Promise<ErcReport | null>;
}
