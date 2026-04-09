export const NM_TO_SCENE = 1_000_000;

export const RENDER_ENGINE_COORDINATE_CONTRACT = {
  worldUnit: "nm",
  sceneUnit: "mm",
  screenUnit: "px",
  yAxis: "up",
} as const;

export type Nanometers = number;
export type Mm = number;
export type SceneMm = Mm;
export type Mils = number;
export type ScreenPx = number;

export interface Vec2 {
  readonly x: Nanometers;
  readonly y: Nanometers;
}

export interface Bounds {
  readonly minX: Nanometers;
  readonly minY: Nanometers;
  readonly maxX: Nanometers;
  readonly maxY: Nanometers;
}

export type Rotation = 0 | 90 | 180 | 270;

export function nmToSceneMm(nm: Nanometers): SceneMm {
  return nm / NM_TO_SCENE;
}

export function sceneMmToNm(sceneMm: SceneMm): Nanometers {
  return sceneMm * NM_TO_SCENE;
}

export function scenePointMmToWorldPointNm(scenePointMm: {
  readonly x: SceneMm;
  readonly y: SceneMm;
}): Vec2 {
  return {
    x: sceneMmToNm(scenePointMm.x),
    y: sceneMmToNm(scenePointMm.y),
  };
}

export const Units = {
  nmToMm: (nm: Nanometers): Mm => nm / 1_000_000,
  mmToNm: (mm: Mm): Nanometers => mm * 1_000_000,
  nmToMils: (nm: Nanometers): Mils => nm / 25_400,
  milsToNm: (mils: Mils): Nanometers => mils * 25_400,
} as const;

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export const EMPTY_BOUNDS: Bounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function expandBounds(bounds: Bounds, padding: Nanometers): Bounds {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

export function pointInBounds(point: Vec2, bounds: Bounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

export function isBoundsValid(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    bounds.maxX >= bounds.minX &&
    bounds.maxY >= bounds.minY
  );
}

export function boundsCenter(bounds: Bounds): Vec2 {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function boundsSize(bounds: Bounds): {
  width: Nanometers;
  height: Nanometers;
} {
  return {
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

export function snapPointToGridNm(point: Vec2, gridSize: Nanometers): Vec2 {
  if (gridSize <= 0) {
    throw new RangeError("gridSize must be greater than 0");
  }
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

export function snapToGrid(point: Vec2, gridSize: Nanometers): Vec2 {
  return snapPointToGridNm(point, gridSize);
}

export const GRID_PRESETS = {
  FINE: Units.mmToNm(0.25),
  SMALL: Units.mmToNm(0.5),
  STANDARD: Units.milsToNm(50),
  COARSE: Units.milsToNm(100),
} as const;
