/** Core PCB schematic types for the frontend */

export type Point = { x: number; y: number };
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

export interface SymbolEntity extends BaseEntity {
  entityType: "symbol";
  symbolKind: SymbolKind;
  reference: string;
  value: string;
  pinCount?: number;
}

export interface WireSegment {
  start: Point;
  end: Point;
}

export interface WireEntity extends BaseEntity {
  entityType: "wire";
  segments: WireSegment[];
}

export interface NetLabelEntity extends BaseEntity {
  entityType: "label";
  text: string;
}

export type SchematicEntity = SymbolEntity | WireEntity | NetLabelEntity;

export interface SchematicDocument {
  id: string;
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
