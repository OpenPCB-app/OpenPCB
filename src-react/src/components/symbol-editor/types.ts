/**
 * Symbol Editor Types
 *
 * Data model for the New Component wizard Step 1 symbol editor.
 * Designed for presets-first MVP with schema extensibility for future primitives.
 */

// ---------------------------------------------------------------------------
// Coordinate System
// ---------------------------------------------------------------------------

/** Internal units: nanometers (same as schematic editor for consistency) */
export type Nanometers = number;

/** 2D point in internal coordinate space */
export interface Point {
  x: Nanometers;
  y: Nanometers;
}

/** Axis-aligned bounding box */
export interface Bounds {
  minX: Nanometers;
  minY: Nanometers;
  maxX: Nanometers;
  maxY: Nanometers;
}

// ---------------------------------------------------------------------------
// Pin Model
// ---------------------------------------------------------------------------

/** Electrical pin type (matches KiCad/semantic contract) */
export type PinElectricalType =
  | "passive"
  | "input"
  | "output"
  | "bidirectional"
  | "power_in"
  | "power_out"
  | "open_collector"
  | "open_emitter"
  | "unspecified";

/** Pin side relative to symbol body */
export type PinSide = "left" | "right" | "top" | "bottom";

/** Pin definition in the symbol editor */
export interface SymbolPin {
  id: string;
  name: string;
  number: string;
  electricalType: PinElectricalType;
  side: PinSide;
  /** Position of pin tip (connection point) in symbol-local coords */
  position: Point;
  /** Length of pin line from body edge to tip */
  length: Nanometers;
}

// ---------------------------------------------------------------------------
// Body Model (Preset-based MVP)
// ---------------------------------------------------------------------------

/** Body preset kinds */
export type BodyPresetKind =
  | "blank"
  | "ic_box"
  | "opamp"
  | "two_pin_passive"
  | "transistor"
  | "diode"
  | "connector"
  | "voltage_regulator";

/** Body preset configuration */
export interface BodyPreset {
  kind: BodyPresetKind;
  /** Width of the body (for ic_box, opamp, two_pin_passive) */
  width: Nanometers;
  /** Height of the body (for ic_box, opamp) */
  height: Nanometers;
}

// ---------------------------------------------------------------------------
// Graphics Primitives (Future extensibility)
// ---------------------------------------------------------------------------

/** Base for all graphics primitives */
interface GraphicBase {
  id: string;
  zIndex: number;
}

export interface LineGraphic extends GraphicBase {
  type: "line";
  x1: Nanometers;
  y1: Nanometers;
  x2: Nanometers;
  y2: Nanometers;
  strokeWidth: number;
}

export interface RectGraphic extends GraphicBase {
  type: "rect";
  x: Nanometers;
  y: Nanometers;
  width: Nanometers;
  height: Nanometers;
  filled: boolean;
  strokeWidth: number;
}

export interface ArcGraphic extends GraphicBase {
  type: "arc";
  cx: Nanometers;
  cy: Nanometers;
  radius: Nanometers;
  startAngle: number;
  endAngle: number;
  strokeWidth: number;
}

export interface CircleGraphic extends GraphicBase {
  type: "circle";
  cx: Nanometers;
  cy: Nanometers;
  radius: Nanometers;
  filled: boolean;
  strokeWidth: number;
}

export interface PolygonGraphic extends GraphicBase {
  type: "polygon";
  points: Point[];
  filled: boolean;
  closed: boolean;
  strokeWidth: number;
}

export interface BezierGraphic extends GraphicBase {
  type: "bezier";
  points: [Point, Point, Point, Point];
  strokeWidth: number;
}

export interface TextGraphic extends GraphicBase {
  type: "text";
  x: Nanometers;
  y: Nanometers;
  content: string;
  fontSize: number;
  rotation: number;
}

export type SymbolGraphic =
  | LineGraphic
  | RectGraphic
  | ArcGraphic
  | CircleGraphic
  | PolygonGraphic
  | BezierGraphic
  | TextGraphic;

// ---------------------------------------------------------------------------
// Symbol Draft Model
// ---------------------------------------------------------------------------

/** Metadata for the symbol being authored */
export interface SymbolMetadata {
  name: string;
  referencePrefix: string;
  description: string;
}

/** Import preservation for KiCad imports */
export interface ImportPreservation {
  /** Original KiCad raw source (s-expression string) */
  rawSource: string | null;
  /** File name if imported */
  sourceFileName: string | null;
  /** Warnings from import */
  warnings: Array<{ code: string; message: string }>;
  /** Number of symbol units detected in source */
  unitCount?: number;
  /** Whether graphics are editable or read-only preserved */
  graphicsEditable: boolean;
}

/** Complete symbol draft for Step 1 */
export interface SymbolDraft {
  /** Unique draft ID */
  id: string;
  /** Symbol metadata */
  metadata: SymbolMetadata;
  /** Body preset or custom body */
  body: BodyPreset;
  /** Pin definitions */
  pins: SymbolPin[];
  /** Custom graphics (future: lines, arcs, etc.) */
  graphics: SymbolGraphic[];
  /** Import preservation data */
  importPreservation: ImportPreservation | null;
}

// ---------------------------------------------------------------------------
// Editor State
// ---------------------------------------------------------------------------

/** Viewport state for canvas */
export interface Viewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

/** Editor tool modes */
export type EditorTool = "select" | "pan";

/** Grid size presets (in nanometers) */
export const GRID_SIZES = {
  fine: 635_000, // 0.025 inch / 0.635mm
  normal: 1_270_000, // 0.05 inch / 1.27mm (default)
  coarse: 2_540_000, // 0.1 inch / 2.54mm
} as const;

export type GridSizeKey = keyof typeof GRID_SIZES;

/** Selection state */
export interface SelectionState {
  selectedPinIds: Set<string>;
  selectedGraphicIds: Set<string>;
}

/** Editor chrome state */
export interface EditorChrome {
  viewport: Viewport;
  activeTool: EditorTool;
  gridSize: Nanometers;
  showGrid: boolean;
  selection: SelectionState;
}

// ---------------------------------------------------------------------------
// Undo/Redo
// ---------------------------------------------------------------------------

/** Snapshot for undo/redo */
export interface HistorySnapshot {
  draft: SymbolDraft;
  timestamp: number;
}

/** History stack state */
export interface HistoryState {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  maxDepth: number;
}

// ---------------------------------------------------------------------------
// Drag-Drop
// ---------------------------------------------------------------------------

/** MIME type for pin drag-drop */
export const PIN_DRAG_MIME = "application/x-openpcb-pin-type";

/** Pin template for drag-drop from palette */
export interface PinTemplate {
  electricalType: PinElectricalType;
  defaultName: string;
  defaultLength: Nanometers;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default pin length */
export const DEFAULT_PIN_LENGTH: Nanometers = 2_540_000; // 0.1 inch

/** Default body dimensions */
export const DEFAULT_BODY_WIDTH: Nanometers = 7_620_000; // 0.3 inch
export const DEFAULT_BODY_HEIGHT: Nanometers = 10_160_000; // 0.4 inch

/** Two-pin passive body dimensions */
export const PASSIVE_BODY_WIDTH: Nanometers = 2_540_000; // 0.1 inch
export const PASSIVE_BODY_HEIGHT: Nanometers = 1_270_000; // 0.05 inch

/** Minimum zoom level (5 pixels/mm - very zoomed out) */
export const MIN_ZOOM = 5;
/** Maximum zoom level (200 pixels/mm - very zoomed in) */
export const MAX_ZOOM = 200;

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

export function createEmptyDraft(id: string): SymbolDraft {
  return {
    id,
    metadata: {
      name: "",
      referencePrefix: "U",
      description: "",
    },
    body: {
      kind: "ic_box",
      width: DEFAULT_BODY_WIDTH,
      height: DEFAULT_BODY_HEIGHT,
    },
    pins: [],
    graphics: [],
    importPreservation: null,
  };
}

export function createPin(
  id: string,
  overrides: Partial<Omit<SymbolPin, "id">> = {},
): SymbolPin {
  return {
    id,
    name: overrides.name ?? "",
    number: overrides.number ?? "1",
    electricalType: overrides.electricalType ?? "passive",
    side: overrides.side ?? "left",
    position: overrides.position ?? { x: 0, y: 0 },
    length: overrides.length ?? DEFAULT_PIN_LENGTH,
  };
}

export function createDefaultViewport(): Viewport {
  return {
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
  };
}

export function createDefaultChrome(): EditorChrome {
  return {
    viewport: createDefaultViewport(),
    activeTool: "select",
    gridSize: GRID_SIZES.normal,
    showGrid: true,
    selection: {
      selectedPinIds: new Set(),
      selectedGraphicIds: new Set(),
    },
  };
}

export function createDefaultHistory(): HistoryState {
  return {
    past: [],
    future: [],
    maxDepth: 50,
  };
}
