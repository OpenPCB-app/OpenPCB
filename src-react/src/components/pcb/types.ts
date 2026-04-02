/** Core PCB schematic types for the frontend */

import type {
  ProjectPoint,
  SchematicLabel,
  SchematicProjectDocument,
  SchematicSymbol as SharedSchematicSymbol,
  SchematicWire,
} from "@shared/types";

export type Point = ProjectPoint;
export type Rotation = 0 | 90 | 180 | 270;
export type MirrorAxis = "horizontal" | "vertical";

export type SymbolKind = string;

export type EntityType = "symbol" | "wire" | "label";

export interface BaseEntity {
  id: string;
  position: Point;
  rotation: number;
  mirrored?: boolean;
}

export type SymbolTemplate = string;

export type EditorSchematicSymbol = SharedSchematicSymbol & {
  entityType: "symbol";
  symbolKind: SymbolKind;
  componentId?: string;
  variantId?: string;
  linkStatus?: "ok" | "missing";
  symbolTemplate?: SymbolTemplate | null;
  mirrored?: boolean;
  reference: string;
  rotation: number;
  value: string;
  pinCount?: number;
};

export type SymbolEntity = EditorSchematicSymbol;

export interface WireEntity extends BaseEntity, SchematicWire {
  entityType: "wire";
}

export interface NetLabelEntity
  extends BaseEntity,
    Omit<SchematicLabel, "position" | "rotation"> {
  entityType: "label";
  text: string;
}

export type SchematicEntity = SymbolEntity | WireEntity | NetLabelEntity;

export interface SchematicDocument
  extends Omit<
    SchematicProjectDocument,
    "symbols" | "wires" | "labels" | "title"
  > {
  name: string;
  revision: number;
  symbols: SymbolEntity[];
  wires: WireEntity[];
  labels: NetLabelEntity[];
}

export interface DerivedNet {
  id: string;
  name: string | null;
  symbolIds: string[];
  wireIds: string[];
  labelIds: string[];
}

export interface DerivedJunction {
  id: string;
  position: Point;
  degree: number;
  wireIds: string[];
}

export interface DerivedConnectivity {
  nets: DerivedNet[];
  junctions: DerivedJunction[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface HitTestCache {
  symbolBounds: Record<string, Bounds>;
  connectorAnchors: Record<string, Point>;
}

export interface DerivedSchematicState {
  connectivity: DerivedConnectivity | null;
  documentBounds: Bounds | null;
  hitTestCache: HitTestCache;
}

export interface Viewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export type ToolMode = "select" | "place" | "wire" | "label";

export type GridStyle = "dots" | "lines" | "cross";

export interface GridPreset {
  id: string;
  name: string;
  size: number;
  style: GridStyle;
}

export const GRID_PRESETS: GridPreset[] = [
  { id: "fine", name: "Fine (0.25mm)", size: 254_000, style: "dots" },
  { id: "small", name: "Small (0.5mm)", size: 508_000, style: "dots" },
  { id: "medium", name: "Medium (1.27mm)", size: 1_270_000, style: "lines" },
  { id: "large", name: "Large (2.54mm)", size: 2_540_000, style: "lines" },
];

export interface EditorChromeState {
  viewport: Viewport;
  selectedEntityIds: Set<string>;
  activeTool: ToolMode;
  popoverEntityId: string | null;
  gridSize: number;
  showGrid: boolean;
  placementRotation: Rotation;
  gridPresetId: string;
}

export interface PlacementSession {
  type: "placement";
  symbolKind: SymbolKind;
  rotation: Rotation;
  previewPosition: Point | null;
}

function inferSymbolKind(reference: string): SymbolKind {
  const normalized = reference.trim().toUpperCase();

  if (normalized.startsWith("R")) return "resistor";
  if (normalized.startsWith("C")) return "capacitor";
  if (normalized.startsWith("L")) return "inductor";
  if (normalized.startsWith("D")) return "diode";
  if (normalized.startsWith("Q")) return "npn";
  if (normalized.startsWith("U")) return "generic_ic";
  if (normalized.startsWith("J")) return "connector";

  return "generic_ic";
}

function normalizeRotationValue(rotation: number | undefined): number {
  if (typeof rotation !== "number" || !Number.isFinite(rotation)) {
    return 0;
  }

  return rotation;
}

function normalizeReferenceValue(
  reference: string | null | undefined,
  fallbackId: string,
): string {
  if (typeof reference === "string" && reference.trim().length > 0) {
    return reference;
  }

  return fallbackId;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeSymbolEntity(symbol: SymbolEntity): SymbolEntity {
  return {
    ...symbol,
    rotation: normalizeRotationValue(symbol.rotation),
    mirrored: symbol.mirrored ?? false,
    symbolTemplate: symbol.symbolTemplate ?? "generic_ic",
    reference: normalizeReferenceValue(symbol.reference, symbol.id),
    componentId: normalizeOptionalString(symbol.componentId),
    variantId: normalizeOptionalString(symbol.variantId),
  };
}

export function toEditorSchematicSymbol(
  symbol: SharedSchematicSymbol,
): SymbolEntity {
  const reference = normalizeReferenceValue(symbol.reference, symbol.id);
  const componentId =
    normalizeOptionalString(symbol.componentId) ??
    normalizeOptionalString(symbol.properties?.component_id);
  const variantId =
    normalizeOptionalString(symbol.variantId) ??
    normalizeOptionalString(symbol.properties?.variant_id);

  return normalizeSymbolEntity({
    ...symbol,
    entityType: "symbol",
    symbolKind: inferSymbolKind(reference),
    componentId,
    variantId,
    symbolTemplate: symbol.symbolTemplate ?? null,
    reference,
    rotation: normalizeRotationValue(symbol.rotation),
    mirrored: false,
    value: symbol.properties?.value ?? "",
  });
}

export function toEditorSchematicDocument(
  document: SchematicProjectDocument,
): SchematicDocument {
  return normalizeSchematicDocument({
    ...document,
    name: document.title ?? "Untitled schematic",
    revision: document.version,
    symbols: document.symbols.map(toEditorSchematicSymbol),
    wires: document.wires.map((wire) => ({
      ...wire,
      entityType: "wire",
      position: wire.points[0] ?? { x: 0, y: 0 },
      rotation: 0,
      mirrored: false,
    })),
    labels: document.labels.map((label) => ({
      ...label,
      entityType: "label",
      rotation: normalizeRotationValue(label.rotation),
      mirrored: false,
    })),
  });
}

export function normalizeSchematicDocument(
  document: SchematicDocument,
): SchematicDocument {
  return {
    ...document,
    symbols: document.symbols.map(normalizeSymbolEntity),
  };
}

export function toSchematicProjectDocument(
  doc: SchematicDocument,
): SchematicProjectDocument {
  return {
    id: doc.id,
    projectId: doc.projectId,
    updatedAt: doc.updatedAt,
    version: doc.revision,
    formatVersion: doc.formatVersion,
    title: doc.name,
    symbols: doc.symbols.map((s) => {
      const properties: Record<string, string> = {
        ...s.properties,
      };

      if (s.value) {
        properties.value = s.value;
      }

      delete properties.component_id;
      delete properties.variant_id;

      return {
        id: s.id,
        componentId: s.componentId ?? null,
        variantId: s.variantId ?? null,
        symbolTemplate: s.symbolTemplate ?? null,
        reference: s.reference,
        position: s.position,
        rotation: s.rotation,
        pins: s.pins,
        properties,
      };
    }),
    wires: doc.wires.map((w) => ({
      id: w.id,
      points: w.points,
      sourcePinId: w.sourcePinId,
      targetPinId: w.targetPinId,
      net: w.net,
    })),
    labels: doc.labels.map((l) => ({
      id: l.id,
      text: l.text,
      position: l.position,
      rotation: l.rotation,
      net: l.net,
    })),
  };
}

export interface WireSession {
  type: "wire";
  sourcePinId: string;
  waypoints: Point[];
  previewPoints: Point[];
  targetPinId: string | null;
}

export interface DragSession {
  type: "drag";
  symbolIds: string[];
  anchorSymbolId: string;
  startPointer: Point;
  lastSnappedDelta: Point;
  initialPositions: Record<string, Point>;
}

export type InteractionSession =
  | PlacementSession
  | WireSession
  | DragSession
  | null;
