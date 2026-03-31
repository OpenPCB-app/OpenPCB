/** Core PCB schematic types for the frontend */

import type {
  ProjectPoint,
  SchematicLabel,
  SchematicProjectDocument,
  SchematicSymbol,
  SchematicWire,
} from "@shared/types";

export type Point = ProjectPoint;
export type Rotation = 0 | 90 | 180 | 270;
export type MirrorAxis = "horizontal" | "vertical";

export type SymbolKind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "diode"
  | "led"
  | "gnd"
  | "vcc_3v3"
  | "vcc_5v"
  | "vcc_12v"
  | "npn"
  | "pnp"
  | "nmos"
  | "pmos"
  | "opamp"
  | "generic_ic"
  | "connector";

export type EntityType = "symbol" | "wire" | "label";

export interface BaseEntity {
  id: string;
  position: Point;
  rotation: Rotation;
  mirrored: boolean;
}

export interface SymbolEntity
  extends BaseEntity,
    Omit<SchematicSymbol, "position" | "rotation" | "reference"> {
  entityType: "symbol";
  symbolKind: SymbolKind;
  reference: string;
  value: string;
  pinCount?: number;
}

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
  extends Omit<SchematicProjectDocument, "symbols" | "wires" | "labels" | "title"> {
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

export interface Viewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export type ToolMode = "select" | "place" | "wire" | "label";

export interface InteractionState {
  /** Wire in progress: vertices so far */
  wireVertices: Point[];
  /** Component being placed (ghost preview) */
  placingGhost: {
    symbolKind: SymbolKind;
    position: Point;
    rotation: Rotation;
  } | null;
  /** Rubber-band selection box */
  selectionBox: { start: Point; end: Point } | null;
  /** Dragging entities */
  dragOffset: Point | null;
}
