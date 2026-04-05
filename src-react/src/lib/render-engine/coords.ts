/**
 * Render Engine — Coordinate System
 *
 * Canonical coordinate types and unit conversions for all canvas implementations.
 * Convention: Y-up (Three.js default), units in nanometers.
 *
 * SCENE SCALE: Three.js float32 loses precision at large values.
 * All nanometer coordinates are divided by NM_TO_SCENE_SCALE before
 * passing to Three.js, so the scene operates in millimeters.
 * Camera zoom of 50 = 50 pixels per mm = comfortable default view.
 */

// ---------------------------------------------------------------------------
// Scene Scale
// ---------------------------------------------------------------------------

/**
 * Divides nanometer coordinates for Three.js scene rendering.
 * Scene units = nanometers / NM_TO_SCENE = millimeters.
 */
export const NM_TO_SCENE = 1_000_000;

/** Convert nanometers to scene units (mm) for Three.js rendering. */
export function nmToScene(nm: number): number {
  return nm / NM_TO_SCENE;
}

/** Convert scene units (mm) back to nanometers. */
export function sceneToNm(scene: number): number {
  return scene * NM_TO_SCENE;
}

// ---------------------------------------------------------------------------
// Unit Types
// ---------------------------------------------------------------------------

/** Internal units: nanometers. All entity positions use this. */
export type Nanometers = number;

/** Millimeters — used at display boundaries and IPC-7351 formulas. */
export type Mm = number;

/** Thousandths of an inch — used for grid presets and legacy compatibility. */
export type Mils = number;

/** Screen pixels — used for viewport transforms. */
export type ScreenPx = number;

// ---------------------------------------------------------------------------
// Coordinate Primitives
// ---------------------------------------------------------------------------

/** 2D point in nanometer coordinate space (Y-up). */
export interface Vec2 {
  readonly x: Nanometers;
  readonly y: Nanometers;
}

/** Axis-aligned bounding box in nanometers. */
export interface Bounds {
  readonly minX: Nanometers;
  readonly minY: Nanometers;
  readonly maxX: Nanometers;
  readonly maxY: Nanometers;
}

/** Rotation values supported by schematic symbols. */
export type Rotation = 0 | 90 | 180 | 270;

// ---------------------------------------------------------------------------
// Unit Conversions
// ---------------------------------------------------------------------------

export const Units = {
  nmToMm: (nm: Nanometers): Mm => nm / 1_000_000,
  mmToNm: (mm: Mm): Nanometers => mm * 1_000_000,
  nmToMils: (nm: Nanometers): Mils => nm / 25_400,
  milsToNm: (mils: Mils): Nanometers => mils * 25_400,
} as const;

// ---------------------------------------------------------------------------
// Angle Conversions
// ---------------------------------------------------------------------------

/** Convert degrees to radians (KiCad stores angles in degrees, Three.js uses radians). */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Convert radians to degrees. */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// Bounds Utilities
// ---------------------------------------------------------------------------

export const EMPTY_BOUNDS: Bounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

/** Merge two bounding boxes into one that contains both. */
export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Expand bounds by a uniform padding in all directions. */
export function expandBounds(bounds: Bounds, padding: Nanometers): Bounds {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

/** Test if a point is inside bounds. */
export function pointInBounds(point: Vec2, bounds: Bounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/** Test if bounds is valid (not empty/inverted). */
export function isBoundsValid(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    bounds.maxX >= bounds.minX &&
    bounds.maxY >= bounds.minY
  );
}

/** Get center point of bounds. */
export function boundsCenter(bounds: Bounds): Vec2 {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/** Get width and height of bounds. */
export function boundsSize(bounds: Bounds): {
  width: Nanometers;
  height: Nanometers;
} {
  return {
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

// ---------------------------------------------------------------------------
// Grid Snapping
// ---------------------------------------------------------------------------

/** Snap a point to the nearest grid intersection. */
export function snapToGrid(point: Vec2, gridSize: Nanometers): Vec2 {
  if (gridSize <= 0) {
    throw new RangeError("gridSize must be greater than 0");
  }
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

// ---------------------------------------------------------------------------
// Common Grid Presets (in nanometers)
// ---------------------------------------------------------------------------

export const GRID_PRESETS = {
  /** 0.25 mm */
  FINE: Units.mmToNm(0.25),
  /** 0.5 mm */
  SMALL: Units.mmToNm(0.5),
  /** 1.27 mm (50 mils) — standard schematic grid */
  STANDARD: Units.milsToNm(50),
  /** 2.54 mm (100 mils) */
  COARSE: Units.milsToNm(100),
} as const;
