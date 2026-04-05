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
  type Mils,
  type ScreenPx,
  type Vec2,
  type Bounds,
  type Rotation,
  Units,
  degreesToRadians,
  radiansToDegrees,
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
  normalizeZoomDelta,
  normalizePanDelta,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./camera/use-eda-camera";

// Interaction
export {
  EdaCanvas,
  type EdaCanvasProps,
  DragDropOverlay,
  type HitResult,
  type InteractionEvent,
  type DragDropEvent,
  type InteractionHandler,
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

// Ready-to-use Canvas Wrappers (drop-in replacements for old Canvas 2D components)
export {
  SchematicCanvasR3F,
  PcbCanvasR3F,
  SymbolEditorCanvasR3F,
  FootprintEditorCanvasR3F,
  SymbolPreviewR3F,
  FootprintPreviewR3F,
} from "./wrappers";
