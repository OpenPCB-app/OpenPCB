/**
 * Render Engine — Interaction Types
 *
 * Common types for mouse/pointer interaction across all canvas implementations.
 * These abstract R3F pointer events into a domain-friendly format.
 */

import type { ThreeEvent } from "@react-three/fiber";
import {
  scenePointMmToWorldPointNm,
  type Mm,
  type Nanometers,
  type ScreenPx,
  type Vec2,
} from "../coords";

export const INTERACTION_COORDINATE_CONTRACT = {
  worldUnit: "nm",
  screenUnit: "px",
  yAxis: "up",
  adapterBoundary: "adapter-local-only",
} as const;

export type WorldPointNm = Vec2;

export interface ScreenPointPx {
  readonly x: ScreenPx;
  readonly y: ScreenPx;
}

export interface AdapterPointMm {
  readonly x: Mm;
  readonly y: Mm;
}

export interface AdapterPointNm {
  readonly x: Nanometers;
  readonly y: Nanometers;
}

/**
 * Adapter-local transform between render-engine world points and adapter units.
 *
 * Core render-engine events stay in nanometers + Y-up. Adapters may translate
 * those points to their own units, but only locally. PCB may use millimeters
 * inside its adapter, and must not surface millimeter points through core APIs.
 */
export interface InteractionAdapterTransform<TAdapterPoint> {
  readonly adapterUnit: "nm" | "mm";
  readonly yAxis: "up";
  readonly boundary: "adapter-local-only";
  toAdapterPoint(worldPointNm: WorldPointNm): TAdapterPoint;
  fromAdapterPoint(adapterPoint: TAdapterPoint): WorldPointNm;
}

export interface InteractionCoordinateTransform {
  readonly sceneUnit: "mm";
  readonly worldUnit: "nm";
  readonly yAxis: "up";
  scenePointToWorldPoint(scenePointMm: AdapterPointMm): WorldPointNm;
}

export const DEFAULT_INTERACTION_COORDINATE_TRANSFORM = {
  sceneUnit: "mm",
  worldUnit: "nm",
  yAxis: "up",
  scenePointToWorldPoint: scenePointMmToWorldPointNm,
} satisfies InteractionCoordinateTransform;

// ---------------------------------------------------------------------------
// Hit Result
// ---------------------------------------------------------------------------

export interface HitResult {
  /** Entity ID from the domain model */
  entityId: string;
  /** Kind of entity hit */
  entityKind:
    | "symbol"
    | "pin"
    | "wire"
    | "netLabel"
    | "placement"
    | "pad"
    | "trace"
    | "via"
    | "graphic";
  /** World-space position of the hit */
  worldPoint: WorldPointNm;
  /** Distance from click point in screen pixels */
  distancePx: ScreenPx;
}

// ---------------------------------------------------------------------------
// Interaction Event
// ---------------------------------------------------------------------------

export interface InteractionEvent {
  /** World-space coordinates of the pointer (nanometers) */
  worldPoint: WorldPointNm;
  /** Grid-snapped world-space coordinates */
  snappedPoint: WorldPointNm;
  /** Screen-space coordinates (pixels from canvas top-left) */
  screenPoint: ScreenPointPx;
  /** Modifier keys */
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    meta: boolean;
    alt: boolean;
  };
  /** Mouse button (0=left, 1=middle, 2=right) */
  button: number;
  /** Original R3F event (when available) */
  nativeEvent?: ThreeEvent<PointerEvent>;
}

// ---------------------------------------------------------------------------
// Drag-Drop Event (HTML overlay bridge)
// ---------------------------------------------------------------------------

export interface DragDropEvent {
  /** World-space coordinates of the drag position */
  worldPoint: WorldPointNm;
  /** Grid-snapped world-space coordinates */
  snappedPoint: WorldPointNm;
  /** MIME types available in the drag */
  types: readonly string[];
  /** Read data for a specific MIME type */
  getData: (mimeType: string) => string;
  /** The drag effect */
  dropEffect: DataTransfer["dropEffect"];
}

// ---------------------------------------------------------------------------
// Interaction Handler Interface
// ---------------------------------------------------------------------------

export interface InteractionHandler {
  onPointerDown?(event: InteractionEvent): void;
  onPointerMove?(event: InteractionEvent): void;
  onPointerUp?(event: InteractionEvent): void;
  onPointerLeave?(): void;

  /** HTML drag-drop events (bridged from overlay) */
  onDragEnter?(event: DragDropEvent): void;
  onDragOver?(event: DragDropEvent): void;
  onDragLeave?(): void;
  onDrop?(event: DragDropEvent): void;
}

// ---------------------------------------------------------------------------
// Drag Threshold
// ---------------------------------------------------------------------------

/** Minimum pixels mouse must move before drag begins (prevents accidental drag on click) */
export const DRAG_THRESHOLD_PX = 5;

/** Connector/pin hit radius in screen pixels */
export const CONNECTOR_HIT_RADIUS_PX = 10;
