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

export type EditorSchematicSymbol = SharedSchematicSymbol & {
  entityType: "symbol";
  symbolKind: SymbolKind;
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

export interface EditorChromeState {
  viewport: Viewport;
  selectedEntityIds: Set<string>;
  activeTool: ToolMode;
  popoverEntityId: string | null;
  gridSize: number;
  showGrid: boolean;
  placementRotation: Rotation;
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

export function normalizeSymbolEntity(symbol: SymbolEntity): SymbolEntity {
  return {
    ...symbol,
    rotation: normalizeRotationValue(symbol.rotation),
    mirrored: symbol.mirrored ?? false,
    reference: normalizeReferenceValue(symbol.reference, symbol.id),
  };
}

export function toEditorSchematicSymbol(
  symbol: SharedSchematicSymbol,
): SymbolEntity {
  const reference = normalizeReferenceValue(symbol.reference, symbol.id);

  return normalizeSymbolEntity({
    ...symbol,
    entityType: "symbol",
    symbolKind: inferSymbolKind(reference),
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
    symbols: doc.symbols.map((s) => ({
      id: s.id,
      libraryPartId: s.libraryPartId,
      reference: s.reference,
      position: s.position,
      rotation: s.rotation,
      pins: s.pins,
      properties: {
        ...s.properties,
        ...(s.value ? { value: s.value } : {}),
      },
    })),
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
  previewPoints: Point[];
  targetPinId: string | null;
}

export type InteractionSession = PlacementSession | WireSession | null;
