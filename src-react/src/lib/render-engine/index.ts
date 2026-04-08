/**
 * Render Engine — Public API
 *
 * Unified rendering system for OpenPCB using Three.js + React Three Fiber.
 * Replaces all Canvas 2D implementations with GPU-accelerated WebGL rendering.
 */

// Coordinates & Units
export {
  type Nanometers,
  type Mm,
  type SceneMm,
  type Mils,
  type ScreenPx,
  type Vec2,
  type Bounds,
  type Rotation,
  RENDER_ENGINE_COORDINATE_CONTRACT,
  Units,
  nmToSceneMm,
  sceneMmToNm,
  degreesToRadians,
  radiansToDegrees,
  snapPointToGridNm,
  snapToGrid,
  mergeBounds,
  expandBounds,
  pointInBounds,
  isBoundsValid,
  boundsCenter,
  boundsSize,
  EMPTY_BOUNDS,
  GRID_PRESETS,
} from "./coords";

// Layers
export {
  RENDER_ORDER,
  type RenderOrderKey,
  type PcbLayerId,
  PCB_LAYER_COLORS,
  createDefaultLayerVisibility,
} from "./layers";

// Camera
export {
  useEdaWheel,
  fitCameraToBounds,
  getWheelNavigationAction,
  isTrackpadWheelEvent,
  normalizeZoomDelta,
  normalizePanDelta,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./camera/use-eda-camera";

export {
  DEFAULT_NORMALIZED_RGB,
  parseShaderColor,
  isDeleteShortcut,
  isEditableShortcutTarget,
  isEscapeShortcut,
  isRedoShortcut,
  isSelectAllShortcut,
  isUndoShortcut,
  matchesKey,
  useWindowKeyboardShortcuts,
  type NormalizedRgb,
  type KeyboardShortcutBinding,
  type KeyboardShortcutEvent,
  type KeyboardShortcutOptions,
} from "./utils";

// Interaction
export {
  EdaCanvas,
  type EdaCanvasProps,
  DragDropOverlay,
  INTERACTION_COORDINATE_CONTRACT,
  type HitResult,
  type InteractionEvent,
  type DragDropEvent,
  type InteractionHandler,
  type WorldPointNm,
  type ScreenPointPx,
  type AdapterPointMm,
  type AdapterPointNm,
  type InteractionAdapterTransform,
  DRAG_THRESHOLD_PX,
  CONNECTOR_HIT_RADIUS_PX,
} from "./interaction";

// Primitives
export {
  GridShader,
  SymbolBody,
  clearGeometryCache,
  WireLines,
  TraceLines,
  PinDots,
  PadInstances,
  ViaInstances,
  JunctionDots,
  RatsnestLines,
  EDAText,
  SelectionOverlay,
  RubberBand,
  PreviewGhost,
} from "./primitives";

// Scenes
export {
  SchematicScene,
  type SchematicSceneConfig,
  PcbScene,
  type PcbSceneConfig,
} from "./scenes";

// Ready-to-use Canvas Adapters (drop-in replacements for old Canvas 2D components)
export {
  SchematicCanvasR3F,
  PcbCanvasR3F,
  SymbolEditorCanvasR3F,
  FootprintEditorCanvasR3F,
  SymbolPreviewR3F,
  FootprintPreviewR3F,
} from "./adapters";
