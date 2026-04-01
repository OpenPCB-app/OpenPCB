/**
 * Footprint Editor Types
 *
 * Data model for the New Component wizard Step 2 footprint editor.
 * All coordinates in millimeters (mm).
 */

// ---------------------------------------------------------------------------
// Coordinate System
// ---------------------------------------------------------------------------

/** Internal units: millimeters */
export type Millimeters = number;

/** 2D point in internal coordinate space */
export interface Point {
  x: Millimeters;
  y: Millimeters;
}

/** Axis-aligned bounding box */
export interface Bounds {
  minX: Millimeters;
  minY: Millimeters;
  maxX: Millimeters;
  maxY: Millimeters;
}

// ---------------------------------------------------------------------------
// Pad Model
// ---------------------------------------------------------------------------

/** Pad shape types */
export type PadShape = "rect" | "circle" | "oval" | "roundrect" | "trapezoid";

/** Pad type (placement method) */
export type PadType = "smd" | "thru_hole" | "np_thru_hole" | "connect";

/** Layer identifiers for pads */
export type PadLayer =
  | "F.Cu"
  | "B.Cu"
  | "F.Mask"
  | "B.Mask"
  | "F.Paste"
  | "B.Paste"
  | "*.Cu"
  | "*.Mask";

/** Pad definition in the footprint editor */
export interface PadDefinition {
  id: string;
  number: string;
  name: string;
  type: PadType;
  shape: PadShape;
  position: Point;
  size: { width: Millimeters; height: Millimeters };
  rotation: number;
  roundrectRatio?: number;
  layers: PadLayer[];
  drillDiameter?: Millimeters;
  drillOffset?: Point;
  pinMapping?: string;
}

// ---------------------------------------------------------------------------
// Graphics Primitives
// ---------------------------------------------------------------------------

/** Layer types for graphics */
export type GraphicLayer =
  | "F.Cu"
  | "B.Cu"
  | "F.SilkS"
  | "B.SilkS"
  | "F.Fab"
  | "B.Fab"
  | "F.CrtYd"
  | "B.CrtYd";

/** Base for all graphics primitives */
interface GraphicBase {
  id: string;
  layer: GraphicLayer;
  strokeWidth: Millimeters;
}

export interface LineGraphic extends GraphicBase {
  type: "line";
  start: Point;
  end: Point;
}

export interface RectGraphic extends GraphicBase {
  type: "rect";
  position: Point;
  width: Millimeters;
  height: Millimeters;
  filled: boolean;
}

export interface CircleGraphic extends GraphicBase {
  type: "circle";
  center: Point;
  radius: Millimeters;
  filled: boolean;
}

export interface ArcGraphic extends GraphicBase {
  type: "arc";
  center: Point;
  radius: Millimeters;
  startAngle: number;
  endAngle: number;
}

export interface PolygonGraphic extends GraphicBase {
  type: "polygon";
  points: Point[];
  filled: boolean;
}

export interface TextGraphic extends GraphicBase {
  type: "text";
  position: Point;
  content: string;
  fontSize: Millimeters;
  rotation: number;
}

export type FootprintGraphic =
  | LineGraphic
  | RectGraphic
  | CircleGraphic
  | ArcGraphic
  | PolygonGraphic
  | TextGraphic;

// ---------------------------------------------------------------------------
// Preset System
// ---------------------------------------------------------------------------

import type { DensityLevel } from "@/lib/ipc-7351/types";

/** Footprint preset kinds */
export type FootprintPresetKind =
  | "chip_2terminal"
  | "soic"
  | "qfp"
  | "qfn"
  | "bga"
  | "dip"
  | "sot"
  | "sod"
  | "melf"
  | "soj"
  | "plcc"
  | "dpak"
  | "polarized_cap"
  | "import";

/** Configuration mode: manual (legacy) or IPC-calculated */
export type FootprintConfigMode = "manual" | "ipc";

export type { DensityLevel } from "@/lib/ipc-7351/types";

/** 2-terminal chip (resistors, caps, inductors) */
export interface Chip2TerminalConfig {
  kind: "chip_2terminal";
  padWidth: Millimeters;
  padHeight: Millimeters;
  padSpacing: Millimeters;
  bodyWidth: Millimeters;
  bodyHeight: Millimeters;
}

/** Small Outline IC (dual-row SMD) */
export interface SoicConfig {
  kind: "soic";
  pinCount: number;
  pitch: Millimeters;
  padWidth: Millimeters;
  padHeight: Millimeters;
  bodyWidth: Millimeters;
  rowSpacing: Millimeters;
}

/** Quad Flat Package */
export interface QfpConfig {
  kind: "qfp";
  pinsPerSide: number;
  pitch: Millimeters;
  padWidth: Millimeters;
  padHeight: Millimeters;
  bodyWidth: Millimeters;
  hasCornerPad: boolean;
}

/** Quad Flat No-lead */
export interface QfnConfig {
  kind: "qfn";
  pinsPerSide: number;
  pitch: Millimeters;
  padWidth: Millimeters;
  padHeight: Millimeters;
  bodyWidth: Millimeters;
  hasCenterPad: boolean;
  centerPadSize: Millimeters;
}

/** Ball Grid Array */
export interface BgaConfig {
  kind: "bga";
  cols: number;
  rows: number;
  pitch: Millimeters;
  ballDiameter: Millimeters;
}

/** Dual In-line Package (through-hole) */
export interface DipConfig {
  kind: "dip";
  pinCount: number;
  pitch: Millimeters;
  rowSpacing: Millimeters;
  drillDiameter: Millimeters;
  padDiameter: Millimeters;
  bodyWidth: Millimeters;
}

/** Small Outline Transistor */
export interface SotConfig {
  kind: "sot";
  variant:
    | "sot23"
    | "sot223"
    | "sot323"
    | "sot353"
    | "sot363"
    | "sot523"
    | "sot723";
}

/** Small Outline Diode */
export interface SodConfig {
  kind: "sod";
  padWidth: Millimeters;
  padHeight: Millimeters;
  padSpacing: Millimeters;
  bodyWidth: Millimeters;
  bodyHeight: Millimeters;
}

/** MELF (cylindrical) */
export interface MelfConfig {
  kind: "melf";
  padWidth: Millimeters;
  padHeight: Millimeters;
  padSpacing: Millimeters;
  bodyWidth: Millimeters;
  bodyDiameter: Millimeters;
}

/** Small Outline J-Lead */
export interface SojConfig {
  kind: "soj";
  pinCount: number;
  pitch: Millimeters;
  padWidth: Millimeters;
  padHeight: Millimeters;
  bodyWidth: Millimeters;
  rowSpacing: Millimeters;
}

/** Plastic Leaded Chip Carrier (J-lead quad) */
export interface PlccConfig {
  kind: "plcc";
  pinsPerSide: number;
  pitch: Millimeters;
  padWidth: Millimeters;
  padHeight: Millimeters;
  bodyWidth: Millimeters;
}

/** D-PAK / TO-252 / TO-263 power package */
export interface DpakConfig {
  kind: "dpak";
  variant: "dpak" | "d2pak";
  tabWidth: Millimeters;
  tabHeight: Millimeters;
}

/** Polarized capacitor (tantalum, electrolytic) */
export interface PolarizedCapConfig {
  kind: "polarized_cap";
  padWidth: Millimeters;
  padHeight: Millimeters;
  padSpacing: Millimeters;
  bodyWidth: Millimeters;
  bodyHeight: Millimeters;
}

/** Import configuration (for KiCAD imports) */
export interface ImportConfig {
  kind: "import";
  sourceFileName: string;
}

/** Union of all preset configurations */
export type PresetConfig =
  | Chip2TerminalConfig
  | SoicConfig
  | QfpConfig
  | QfnConfig
  | BgaConfig
  | DipConfig
  | SotConfig
  | SodConfig
  | MelfConfig
  | SojConfig
  | PlccConfig
  | DpakConfig
  | PolarizedCapConfig
  | ImportConfig;

// ---------------------------------------------------------------------------
// Footprint Draft Model
// ---------------------------------------------------------------------------

/** Metadata for the footprint being authored */
export interface FootprintMetadata {
  name: string;
  reference: string;
  description: string;
}

/** Import preservation for KiCad imports */
export interface ImportPreservation {
  rawSource: string;
  sourceFileName: string;
  warnings: Array<{ code: string; message: string }>;
}

/** Complete footprint draft for Step 2 */
export interface FootprintDraft {
  id: string;
  metadata: FootprintMetadata;
  preset: FootprintPresetKind;
  config: PresetConfig;
  configMode: FootprintConfigMode;
  densityLevel: DensityLevel;
  pads: PadDefinition[];
  graphics: FootprintGraphic[];
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

/** Grid size presets (in millimeters) */
export const GRID_SIZES = {
  fine: 0.05,
  normal: 0.1,
  coarse: 0.25,
  very_coarse: 0.5,
} as const;

export type GridSizeKey = keyof typeof GRID_SIZES;

/** Selection state */
export interface SelectionState {
  selectedPadIds: Set<string>;
  selectedGraphicIds: Set<string>;
}

/** Editor chrome state */
export interface EditorChrome {
  viewport: Viewport;
  activeTool: EditorTool;
  gridSize: Millimeters;
  showGrid: boolean;
  selection: SelectionState;
}

// ---------------------------------------------------------------------------
// Undo/Redo
// ---------------------------------------------------------------------------

/** Snapshot for undo/redo */
export interface HistorySnapshot {
  draft: FootprintDraft;
  timestamp: number;
}

/** History stack state */
export interface HistoryState {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  maxDepth: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default pad dimensions */
export const DEFAULT_PAD_WIDTH: Millimeters = 0.6;
export const DEFAULT_PAD_HEIGHT: Millimeters = 0.5;

/** Minimum zoom level */
export const MIN_ZOOM = 0.1;
/** Maximum zoom level */
export const MAX_ZOOM = 50;

/** Common pitch values */
export const COMMON_PITCHES = {
  fine: 0.4,
  standard: 0.5,
  coarse: 0.65,
  wide: 1.27,
} as const;

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

export function createEmptyDraft(id: string): FootprintDraft {
  return {
    id,
    metadata: {
      name: "",
      reference: "",
      description: "",
    },
    preset: "chip_2terminal",
    config: {
      kind: "chip_2terminal",
      padWidth: 0.7,
      padHeight: 0.95,
      padSpacing: 1.55,
      bodyWidth: 1.6,
      bodyHeight: 0.8,
    },
    configMode: "manual",
    densityLevel: "nominal",
    pads: [],
    graphics: [],
    importPreservation: null,
  };
}

export function createPad(
  id: string,
  overrides: Partial<Omit<PadDefinition, "id">> = {},
): PadDefinition {
  return {
    id,
    number: overrides.number ?? "1",
    name: overrides.name ?? "",
    type: overrides.type ?? "smd",
    shape: overrides.shape ?? "rect",
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? {
      width: DEFAULT_PAD_WIDTH,
      height: DEFAULT_PAD_HEIGHT,
    },
    rotation: overrides.rotation ?? 0,
    roundrectRatio: overrides.roundrectRatio,
    layers: overrides.layers ?? ["F.Cu", "F.Mask"],
    pinMapping: overrides.pinMapping,
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
      selectedPadIds: new Set(),
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
