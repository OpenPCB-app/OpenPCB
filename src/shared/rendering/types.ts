export interface PointMm {
  readonly x: number;
  readonly y: number;
}

export interface BoundsMm {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface PreviewWarning {
  readonly code: string;
  readonly message: string;
}

export interface PreviewLineGraphic {
  readonly kind: "line";
  readonly a: PointMm;
  readonly b: PointMm;
  readonly strokeWidthMm: number;
  readonly layer?: string;
}

export interface PreviewRectGraphic {
  readonly kind: "rect";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: "none" | "solid";
  readonly strokeWidthMm: number;
  readonly layer?: string;
}

export interface PreviewCircleGraphic {
  readonly kind: "circle";
  readonly center: PointMm;
  readonly radiusMm: number;
  readonly fill: "none" | "solid";
  readonly strokeWidthMm: number;
  readonly layer?: string;
}

export interface PreviewArc3PointGraphic {
  readonly kind: "arc3";
  readonly start: PointMm;
  readonly mid: PointMm;
  readonly end: PointMm;
  readonly strokeWidthMm: number;
  readonly layer?: string;
}

export interface PreviewPolylineGraphic {
  readonly kind: "polyline";
  readonly points: readonly PointMm[];
  readonly closed: boolean;
  readonly fill: "none" | "solid";
  readonly strokeWidthMm: number;
  readonly layer?: string;
}

export interface PreviewBezierGraphic {
  readonly kind: "bezier";
  readonly points: readonly [PointMm, PointMm, PointMm, PointMm];
  readonly strokeWidthMm: number;
  readonly layer?: string;
}

export type PreviewGraphic =
  | PreviewLineGraphic
  | PreviewRectGraphic
  | PreviewCircleGraphic
  | PreviewArc3PointGraphic
  | PreviewPolylineGraphic
  | PreviewBezierGraphic;

export type LabelAnchorX = "left" | "center" | "right";
export type LabelAnchorY =
  | "top"
  | "middle"
  | "bottom"
  | "top-baseline"
  | "bottom-baseline";

export interface PreviewLabel {
  readonly id: string;
  readonly text: string;
  readonly at: PointMm;
  readonly fontSizeMm: number;
  readonly rotationDeg: number;
  readonly anchorX: LabelAnchorX;
  readonly anchorY: LabelAnchorY;
  readonly layer?: string;
  readonly role?:
    | "pin-name"
    | "pin-number"
    | "reference"
    | "value"
    | "footprint-text";
}

export interface SymbolPreviewSourcePin {
  readonly id: string;
  readonly name: string;
  readonly number: string | null;
  readonly electricalType: string;
  readonly positionMm: PointMm;
  readonly lengthMm: number;
  readonly rotationDeg: number;
  readonly unit: number;
  readonly hidden: boolean;
}

export interface SymbolPreviewSourceGraphic {
  readonly unit: number;
  readonly graphic: PreviewGraphic;
}

export interface SymbolPreviewSourceLabel {
  readonly unit: number;
  readonly label: PreviewLabel;
}

export interface SymbolPreviewSource {
  readonly name: string;
  readonly unitCount: number;
  readonly referenceText: string;
  readonly valueText: string;
  readonly pins: readonly SymbolPreviewSourcePin[];
  readonly graphics: readonly SymbolPreviewSourceGraphic[];
  readonly labels?: readonly SymbolPreviewSourceLabel[];
  readonly warnings: readonly PreviewWarning[];
}

export interface SymbolPreviewModelPin {
  readonly id: string;
  readonly name: string;
  readonly number: string | null;
  readonly electricalType: string;
  readonly unit: number;
  readonly anchor: PointMm;
  readonly bodyEnd: PointMm;
  readonly rotationDeg: number;
}

export interface SymbolPreviewModel {
  readonly kind: "symbol";
  readonly units: "mm";
  readonly name: string;
  readonly unitCount: number;
  readonly graphics: readonly PreviewGraphic[];
  readonly pins: readonly SymbolPreviewModelPin[];
  readonly labels: readonly PreviewLabel[];
  readonly bounds: BoundsMm | null;
  readonly warnings: readonly PreviewWarning[];
}

export interface FootprintPreviewSourcePad {
  readonly id: string;
  readonly number: string;
  readonly shape:
    | "circle"
    | "rect"
    | "oval"
    | "roundrect"
    | "trapezoid"
    | "custom";
  readonly centerMm: PointMm;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly rotationDeg: number;
  readonly roundrectRatio?: number;
  readonly drillDiameterMm?: number;
  readonly layer?: string;
}

export interface FootprintPreviewSource {
  readonly name: string;
  readonly pads: readonly FootprintPreviewSourcePad[];
  readonly graphics: readonly PreviewGraphic[];
  readonly labels: readonly PreviewLabel[];
  readonly warnings: readonly PreviewWarning[];
}

export interface FootprintPreviewModel {
  readonly kind: "footprint";
  readonly units: "mm";
  readonly name: string;
  readonly pads: readonly FootprintPreviewSourcePad[];
  readonly graphics: readonly PreviewGraphic[];
  readonly labels: readonly PreviewLabel[];
  readonly bounds: BoundsMm | null;
  readonly warnings: readonly PreviewWarning[];
}

export interface BuildSymbolPreviewModelOptions {
  readonly composeAllUnits?: boolean;
  readonly includeHiddenPins?: boolean;
  readonly unitGapMm?: number;
}

export interface BuildFootprintPreviewModelOptions {
  readonly includeLayerNames?: readonly string[];
  readonly includePadLayerNames?: readonly string[];
}
