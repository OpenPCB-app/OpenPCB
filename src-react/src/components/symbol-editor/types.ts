/**
 * Symbol Editor Types
 *
 * Data model for the New Component wizard Step 1 symbol editor.
 * Coordinate types and graphic primitives re-exported from canvas-core.
 */

import type {
  Nanometers as _Nanometers,
  Point as _Point,
  Bounds as _Bounds,
  PinSide as _PinSide,
  SymbolGraphic as _SymbolGraphic,
} from "@/lib/canvas-core/types";

// ---------------------------------------------------------------------------
// Coordinate System (re-exported from canvas-core)
// ---------------------------------------------------------------------------

export type Nanometers = _Nanometers;
export type Point = _Point;
export type Bounds = _Bounds;
export type PinSide = _PinSide;

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
// Graphics Primitives (re-exported from canvas-core)
// ---------------------------------------------------------------------------

export type SymbolGraphic = _SymbolGraphic;
export type {
  LineGraphic,
  RectGraphic,
  ArcGraphic,
  CircleGraphic,
  PolygonGraphic,
  BezierGraphic,
  TextGraphic,
} from "@/lib/canvas-core/types";

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
  normalizedSchematicGeometry?: boolean;
}

/** Complete symbol draft for Step 1 */
export interface SymbolDraft {
  /** Unique draft ID */
  id: string;
  /** Symbol metadata */
  metadata: SymbolMetadata;
  /** Pin definitions */
  pins: SymbolPin[];
  /** Symbol graphics — THE symbol definition (lines, circles, arcs, etc.) */
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
export type EditorTool = "select" | "pan" | "line" | "rect" | "circle";

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

/** Minimum zoom level (5 pixels/mm - very zoomed out) */
export const MIN_ZOOM = 5;
/** Maximum zoom level (200 pixels/mm - very zoomed in) */
export const MAX_ZOOM = 200;
/** Default zoom level (50 pixels/mm - comfortable editing) */
export const DEFAULT_ZOOM = 50;

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
    zoom: DEFAULT_ZOOM,
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
