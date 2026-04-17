import type { EditorTool as SharedEditorTool } from "../../../../../shared/frontend/canvas/tools/types";
import type {
  PreviewGraphic,
  PreviewLabel,
  PointMm,
} from "../../../../../shared/rendering/types";

export type FootprintEditorToolId =
  | "select"
  | "line"
  | "rect"
  | "circle"
  | "arc"
  | "pad"
  | "text";

export type FootprintEditorTool = SharedEditorTool<FootprintEditorToolId>;

export type PadShape = "rect" | "circle" | "oval" | "roundrect";

export interface EditorPadElement {
  readonly id: string;
  readonly number: string;
  readonly shape: PadShape;
  readonly centerMm: PointMm;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly rotationDeg: number;
  readonly roundrectRatio?: number;
  readonly drillDiameterMm?: number;
  readonly layer: string;
}

export interface EditorFootprintGraphic {
  readonly id: string;
  readonly graphic: PreviewGraphic;
  readonly layer: string;
}

export interface EditorFootprintLabel {
  readonly id: string;
  readonly label: PreviewLabel;
}

export interface EditorFootprintSnapshot {
  readonly pads: readonly EditorPadElement[];
  readonly graphics: readonly EditorFootprintGraphic[];
  readonly labels: readonly EditorFootprintLabel[];
}

export interface PadDefaults {
  readonly shape: PadShape;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly rotationDeg: number;
  readonly layer: string;
  readonly drillDiameterMm: number | null;
  readonly roundrectRatio: number;
}

export interface FootprintEditorTextEditorState {
  readonly labelId: string | null;
  readonly worldMm: PointMm;
  readonly screenX: number;
  readonly screenY: number;
  readonly initialText: string;
}

/** All PCB layers the editor exposes. */
export const PCB_EDITOR_LAYERS = [
  "F.Cu",
  "B.Cu",
  "F.SilkS",
  "B.SilkS",
  "F.CrtYd",
  "B.CrtYd",
  "F.Fab",
  "B.Fab",
  "Edge.Cuts",
] as const;

export type PcbEditorLayer = (typeof PCB_EDITOR_LAYERS)[number];
