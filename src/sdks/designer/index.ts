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
  DrcReport,
  ErcReport,
  KicadProjectCommitRequest,
  KicadProjectCommitResult,
  KicadProjectInspectReport,
  UpdateDesignerDesignInput,
} from "./types";
import type {
  LibraryComponent,
  LibraryComponentPlacementDetail,
} from "../library";

export type {
  CreateDesignerDesignInput,
  DesignerAutoArrangeSchematicCommand,
  DesignerCommand,
  DesignerCommandEnvelope,
  DesignerCommandOkResult,
  DesignerCreateWireCommand,
  DesignerCreateWireJunctionCommand,
  DesignerDeleteEntityCommand,
  DesignerDerivedNet,
  DesignerDesignRecord,
  DesignerDesignSummary,
  DesignerDrcStatus,
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
  PcbBoardOutlineRect,
  PcbBoardOutlineRoundRect,
  PcbBoardOutlineCircle,
  PcbBoardOutlinePolygon,
  PcbBoardContour,
  PcbOutlineSegment,
  PcbBoardCutout,
  PcbBoardCutoutShape,
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
  PcbZone,
  PcbDrillSlot,
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
  DesignerPcbSetBoardOutlineCommand,
  DesignerPcbSetViewStateCommand,
  DesignerPcbSetDesignRulesCommand,
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
  DrcAnchor,
  DrcReport,
  DrcRuleClass,
  DrcRuleCode,
  DrcSeverity,
  DrcViolation,
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
  DesignerSchematicPreview,
  DesignerSchematicProjection,
  DesignerSearchLibraryParams,
  DesignerUpdatePartPropertiesCommand,
  DesignerUpdatePartsPropertiesCommand,
  DesignerUpsertLabelCommand,
  DesignerWire,
  KicadProjectCommitRequest,
  KicadProjectCommitResult,
  KicadProjectDeferredEntityKind,
  KicadProjectImportComponentRow,
  KicadProjectImportCounts,
  KicadProjectImportNetClass,
  KicadProjectImportWarning,
  KicadProjectInspectReport,
  UpdateDesignerDesignInput,
  GerberArtifactKind,
  GerberArtifact,
  GerberExportOptions,
  GerberExportRequest,
  GerberExportResult,
  BomRow,
  BomLine,
  BomLineRef,
  BomOverride,
  BomOverridePatch,
  BomProjection,
  BomSummary,
  CentroidRow,
} from "./types";
export type { DesignerInvalidatedEvent } from "./events";
export { placementMirrorX, exportBundleName } from "./pcb-helpers";

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
  /**
   * Fetch the schematic projection ONCE and run ERC over that same object,
   * returning both at a single revision. Prefer this over calling
   * `getSchematicProjection` + `runErc` separately (which double-fetches and
   * can interleave a mutation between the two reads). Returns `null` when the
   * design has no schematic projection.
   */
  getProjectionAndErc(designId: string): Promise<{
    projection: DesignerSchematicProjection;
    erc: ErcReport;
  } | null>;
  /** Run the DRC engine over the current PCB projection. Returns `null` when the design has no PCB projection. */
  runDrc(designId: string): Promise<DrcReport | null>;
  /**
   * Parse a KiCad project ZIP and return an inspect report (no DB writes).
   * The wizard renders this to the user before commit.
   */
  inspectKicadProject(
    archiveFileName: string,
    archiveBytes: Uint8Array,
  ): Promise<KicadProjectInspectReport>;
  /**
   * Commit a KiCad project import. v1 creates the design + board settings +
   * outline + net classes; full schematic/PCB entity ingestion is deferred
   * (see `KicadProjectCommitResult.applied.deferred`).
   */
  commitKicadProject(
    request: KicadProjectCommitRequest,
  ): Promise<KicadProjectCommitResult>;
}
