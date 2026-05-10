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

export interface HitResult {
  entityId: string;
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
  worldPoint: WorldPointNm;
  distancePx: ScreenPx;
}

export interface InteractionEvent {
  worldPoint: WorldPointNm;
  snappedPoint: WorldPointNm;
  screenPoint: ScreenPointPx;
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    meta: boolean;
    alt: boolean;
  };
  button: number;
  nativeEvent?: ThreeEvent<PointerEvent>;
}

export interface DragDropEvent {
  worldPoint: WorldPointNm;
  snappedPoint: WorldPointNm;
  types: readonly string[];
  getData: (mimeType: string) => string;
  dropEffect: DataTransfer["dropEffect"];
}

export interface InteractionHandler {
  onPointerDown?(event: InteractionEvent): void;
  onPointerMove?(event: InteractionEvent): void;
  onPointerUp?(event: InteractionEvent): void;
  onPointerLeave?(): void;
  onContextMenu?(event: InteractionEvent): void;
  onDragEnter?(event: DragDropEvent): void;
  onDragOver?(event: DragDropEvent): void;
  onDragLeave?(): void;
  onDrop?(event: DragDropEvent): void;
}

export const DRAG_THRESHOLD_PX = 5;
export const CONNECTOR_HIT_RADIUS_PX = 10;
