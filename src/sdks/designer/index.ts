import type {
  CreateDesignerDesignInput,
  DesignerCommandEnvelope,
  DesignerDesignRecord,
  DesignerDesignSummary,
  DesignerDispatchResult,
  DesignerHistoryActionResult,
  DesignerHistorySnapshot,
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
  createDesign(input?: CreateDesignerDesignInput): Promise<DesignerDesignSummary>;
  listDesigns(): Promise<DesignerDesignSummary[]>;
  getDesign(designId: string): Promise<DesignerDesignRecord | null>;
  getSchematicProjection(
    designId: string,
  ): Promise<DesignerSchematicProjection | null>;
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
