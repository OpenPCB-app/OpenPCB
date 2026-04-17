/**
 * Public SDK contracts modules implement/consume.
 *
 * This layer is intentionally outside core/ so module contracts can evolve
 * without coupling to infra internals.
 */

import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../shared/rendering/types";
import type { CommandEnvelope } from "../../shared/domain/commands/command-envelope";

export interface LibraryComponent {
  id: string;
  name: string;
  description: string;
  symbolId: string;
  footprintId: string;
  tags: string[];
}

export interface LibrarySymbol {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface LibraryFootprint {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface LibraryPreviewWarning {
  code: string;
  message: string;
}

export interface LibrarySourceProvenance {
  sourceKind: string | null;
  sourceFormat: string | null;
  fileName: string | null;
  importedAt: string | null;
  sourceHash: string | null;
}

export interface LibrarySymbolDetail {
  id: string;
  name: string;
  referencePrefix: string | null;
  pinCount: number;
  warnings: LibraryPreviewWarning[];
  preview: Record<string, unknown> | null;
  provenance: LibrarySourceProvenance | null;
}

export interface LibraryFootprintDetail {
  id: string;
  name: string;
  mountType: string | null;
  padCount: number;
  packageCode: {
    imperial: string | null;
    metric: string | null;
  };
  warnings: LibraryPreviewWarning[];
  preview: Record<string, unknown> | null;
  provenance: LibrarySourceProvenance | null;
}

export interface LibraryComponentDetail {
  component: LibraryComponent;
  symbol: LibrarySymbolDetail;
  footprint: LibraryFootprintDetail;
}

export interface LibrarySymbolPinSnapshot {
  originPinKey: string;
  number: string | null;
  name: string;
  localPositionMm: {
    x: number;
    y: number;
  };
  electricalType: string;
  unit: number;
}

export interface LibrarySymbolPlacementSnapshot {
  symbolId: string;
  name: string;
  referencePrefix: string | null;
  sourceHash: string | null;
  pins: LibrarySymbolPinSnapshot[];
  preview: SymbolRenderModel; // Required for schematic rendering - no null
}

export interface LibraryFootprintPlacementSnapshot {
  footprintId: string;
  name: string;
  mountType: string | null;
  sourceHash: string | null;
  preview: FootprintRenderModel | null;
}

export interface LibraryComponentPlacementDetail {
  component: LibraryComponent;
  symbol: LibrarySymbolPlacementSnapshot;
  footprint: LibraryFootprintPlacementSnapshot;
  resolvedAt: string;
}

export interface LibrarySearchParams {
  query?: string;
  limit?: number;
  tags?: string[];
}

export interface LibrarySDK {
  resolveComponent(componentId: string): Promise<LibraryComponent | null>;
  getSymbol(symbolId: string): Promise<LibrarySymbol | null>;
  getFootprint(footprintId: string): Promise<LibraryFootprint | null>;
  getComponentDetail(componentId: string): Promise<LibraryComponentDetail | null>;
  searchComponents(params: LibrarySearchParams): Promise<LibraryComponent[]>;
  resolveComponentForPlacement(
    componentId: string,
  ): Promise<LibraryComponentPlacementDetail | null>;
}

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

export type DesignerCommand =
  | DesignerPlacePartCommand
  | DesignerCreateWireCommand
  | DesignerCreateWireJunctionCommand
  | DesignerMovePartCommand
  | DesignerRotatePartCommand
  | DesignerMirrorPartCommand
  | DesignerDeleteEntityCommand
  | DesignerUpsertLabelCommand;

export type DesignerCommandEnvelope = CommandEnvelope<DesignerCommand>;

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
    };

export interface DesignerSearchLibraryParams {
  query?: string;
  tags?: string[];
  limit?: number;
}

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
}
