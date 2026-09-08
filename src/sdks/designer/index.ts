import type {
  BomProjection,
  CreateDesignerDesignInput,
  DesignerCommandEnvelope,
  GerberExportOptions,
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
  DesignerCommentAnchor,
  DesignerCommentAnchorEntityKind,
  DesignerCommentAttachment,
  DesignerCommentCommand,
  DesignerCommentCommandEnvelope,
  DesignerCommentCommandResult,
  DesignerCommentMessage,
  DesignerCommentMessageKind,
  DesignerCommentReaction,
  DesignerCommentSurface,
  DesignerCommentSyncState,
  DesignerCommentThread,
  DesignerCommentThreadPage,
  DesignerCommentThreadStatus,
  DesignerCommentTodoStatus,
  DesignerCreateWireCommand,
  DesignerCreateWireJunctionCommand,
  DesignerUpdateWireGeometryCommand,
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
  AutoLayoutConfig,
  AutoLayoutPlaceConfig,
  AutoLayoutRouteConfig,
  PcbLengthMatchGroup,
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
  PcbZoneRegion,
  PcbZonePadConnection,
  PcbZoneIslandRemoval,
  PcbKeepout,
  PcbKeepoutRestrictions,
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
  RatsnestEndpoint,
  DesignerPcbProjection,
  DesignerPcbAddTraceCommand,
  DesignerPcbAddTraceViaCommand,
  DesignerPcbAddViaCommand,
  DesignerPcbCommitRouteCommand,
  DesignerPcbApplyAutolayoutCandidateCommand,
  DesignerPcbCandidatePlacementOperation,
  DesignerPcbCandidateRouteOperation,
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
  PcbZoneNetRef,
  DesignerPcbAddZoneCommand,
  DesignerPcbUpdateZoneCommand,
  DesignerPcbDeleteZoneCommand,
  DesignerPcbAddKeepoutCommand,
  DesignerPcbUpdateKeepoutCommand,
  DesignerPcbDeleteKeepoutCommand,
  ErcAnchor,
  ErcReport,
  ErcSeverity,
  ErcViolation,
  DrcAnchor,
  DrcPairKind,
  DrcReport,
  DrcRuleClass,
  DrcRuleCode,
  DrcRuleConstraint,
  DrcRuleScope,
  DrcSeverity,
  DrcViolation,
  PcbDrcRule,
  PcbDiffPair,
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

/**
 * Optional dataset-capture attribution for a dispatched command (WP-D4).
 * The command envelope has no actor field and session ids are fixed per
 * surface, so origin is only knowable at the call site.
 */
export interface DesignerDispatchCaptureMeta {
  actor: "user" | "assistant" | "autolayout_apply" | "import";
  jobId?: string;
  appliedCandidateId?: string;
  /** Links the commands of one apply/proposal loop (the batch surrogate). */
  groupId?: string;
}

export interface DesignerSDK {
  createDesign(
    input?: CreateDesignerDesignInput,
  ): Promise<DesignerDesignSummary>;
  listDesigns(): Promise<DesignerDesignSummary[]>;
  /**
   * The design the designer UI currently has focused, or `null` when nothing
   * is open. Pushed by the frontend tab store and held in memory — callers
   * driving the design from outside the UI (MCP) use it as their default
   * target. `null` is a normal answer, not an error.
   */
  getActiveDesignId(): string | null;
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
    capture?: DesignerDispatchCaptureMeta,
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
  /**
   * S6: read the design's cloud link (null when not linked). Exposes the
   * cloud identity + last synced revision so cross-module callers (assistant
   * cloud-chat) can run the sync gate without touching designer internals.
   */
  getCloudLink(designId: string): Promise<DesignerCloudLinkInfo | null>;
  /**
   * S6 sync gate: push the current projection to the cloud when the cloud
   * copy is behind (desktop-authoritative `POST /v1/designs/:id/snapshot`).
   * No-op when revisions already match. Throws when the design is unlinked
   * or the cloud rejects the reseed (revision regression).
   */
  pushCloudSnapshot(
    designId: string,
    ctx: { bearer: string; apiUrl: string },
  ): Promise<{ pushed: boolean; revision: number; cloudDesignId: string }>;
  /**
   * S8: build a cloud BoardSnapshot from the design's PCB projection (pure,
   * no network — the assistant cloud-chat executor pushes the result to
   * cloud-copilot at run start). Null when the design has no PCB projection.
   */
  buildBoardSnapshot(designId: string): Promise<DesignerBoardSnapshotBuild | null>;
  /** BOM projection (grouped lines + summary). Null when the design is unknown. */
  getBomProjection(designId: string): Promise<BomProjection | null>;
  /**
   * Manufacturing export manifest: bundle name, preflight warnings, and one
   * entry per artifact with its byte size — deliberately WITHOUT file text, so
   * cross-module callers can report on an export without pulling megabytes of
   * Gerber through the tool layer. Null when the design has no PCB projection.
   */
  getManufacturingExportSummary(
    designId: string,
    options?: GerberExportOptions,
  ): Promise<DesignerExportSummary | null>;
}

/** Result of DesignerSDK.getManufacturingExportSummary. */
export interface DesignerExportSummary {
  bundleName: string;
  warnings: string[];
  files: Array<{ kind: string; fileName: string; bytes: number }>;
}

/** Cloud link summary surfaced through the SDK (subset of designer_cloud_link). */
export interface DesignerCloudLinkInfo {
  cloudDesignId: string;
  cloudWorkspaceId: string;
  lastSyncedRevision: number;
}

/** Result of DesignerSDK.buildBoardSnapshot (S8). */
export interface DesignerBoardSnapshotBuild {
  snapshot: import("./autoroute").BoardSnapshot;
  warnings: string[];
}

// Cloud auto-router wire contracts (BoardSnapshot / RouteResultEnvelope / ProgressFrame).
export * from "./stackup";
export type * from "./autoroute";
// Cloud auto-place wire contracts (PlacementResultEnvelope / PlaceOperation / PlaceProgressFrame).
// Reuses BoardSnapshot / SnapshotPlacement / PlaceOptions / PlaceWeights from ./autoroute.
export type * from "./autoplace";
