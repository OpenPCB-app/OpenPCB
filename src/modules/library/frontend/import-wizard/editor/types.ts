import type { ReactNode } from "react";
import type { InteractionEvent } from "../../../../../shared/frontend/canvas/interaction/types";
import type {
  PreviewGraphic,
  PointMm,
} from "../../../../../shared/rendering/types";

export type EditorToolId =
  | "select"
  | "line"
  | "rect"
  | "circle"
  | "arc"
  | "pin";

export interface EditorGraphicElement {
  readonly id: string;
  readonly graphic: PreviewGraphic;
}

export interface EditorPinElement {
  readonly id: string;
  readonly name: string;
  readonly number: string;
  readonly electricalType: string;
  readonly positionMm: PointMm;
  readonly lengthMm: number;
  readonly rotationDeg: number;
}

export interface EditorTool {
  readonly id: EditorToolId;
  readonly cursor: string;
  onActivate?(): void;
  onDeactivate?(): void;
  onPointerDown?(event: InteractionEvent): void;
  onPointerMove?(event: InteractionEvent): void;
  onPointerUp?(event: InteractionEvent): void;
  onKeyDown?(event: KeyboardEvent): void;
  /** Rubber-band preview rendered in canvas during interaction */
  render?(): ReactNode;
}

export interface EditorSnapshot {
  readonly graphics: readonly EditorGraphicElement[];
  readonly pins: readonly EditorPinElement[];
}
