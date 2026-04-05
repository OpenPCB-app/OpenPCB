/**
 * Canvas Core — Shared Types
 *
 * Canonical type definitions for coordinates, bounds, viewport,
 * and graphic primitives used by all canvas implementations.
 *
 * Coordinate convention: Y-down, units in nanometers.
 */

// ---------------------------------------------------------------------------
// Coordinate System
// ---------------------------------------------------------------------------

/** Internal units: nanometers */
export type Nanometers = number;

/** 2D point in nanometer coordinate space */
export interface Point {
  x: Nanometers;
  y: Nanometers;
}

/** Axis-aligned bounding box in nanometers */
export interface Bounds {
  minX: Nanometers;
  minY: Nanometers;
  maxX: Nanometers;
  maxY: Nanometers;
}

/** Canvas viewport state. zoom = pixels per nanometer (Y-down). */
export interface Viewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export type GridStyle = "dots" | "lines" | "cross";

export interface GridColors {
  dot: string;
  dotFaint: string;
  majorLine: string;
  originCross: string;
}

// ---------------------------------------------------------------------------
// Pin Side
// ---------------------------------------------------------------------------

export type PinSide = "left" | "right" | "top" | "bottom";

// ---------------------------------------------------------------------------
// Graphic Primitives
// ---------------------------------------------------------------------------

/** Base for all graphic primitives */
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
// Renderable Pin (for shared pin renderer)
// ---------------------------------------------------------------------------

export interface RenderablePin {
  id: string;
  name: string;
  position: Point;
  number?: string;
  side?: PinSide;
  length?: Nanometers;
}
