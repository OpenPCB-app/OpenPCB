import type {
  PreviewGraphic,
  PreviewLabel,
  PointMm,
} from "../../../../../shared/rendering/types";
import type { EditorTool as SharedEditorTool } from "../../../../../shared/frontend/canvas/tools/types";

export type EditorToolId =
  | "select"
  | "line"
  | "rect"
  | "circle"
  | "arc"
  | "pin"
  | "text";

export type EditorTool = SharedEditorTool<EditorToolId>;

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

export interface EditorLabelElement {
  readonly id: string;
  readonly label: PreviewLabel;
}

export interface EditorTextEditorState {
  /** null when creating a new label; non-null when editing an existing label's text. */
  readonly labelId: string | null;
  readonly worldMm: PointMm;
  readonly screenX: number;
  readonly screenY: number;
  readonly initialText: string;
}

export interface EditorSnapshot {
  readonly graphics: readonly EditorGraphicElement[];
  readonly pins: readonly EditorPinElement[];
  readonly labels: readonly EditorLabelElement[];
}
