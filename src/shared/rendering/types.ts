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

export interface SymbolRenderSourcePin {
  readonly id: string;
  readonly name: string;
  readonly number: string | null;
  readonly electricalType: string;
  readonly positionMm: PointMm;
  readonly lengthMm: number;
  readonly rotationDeg: number;
  readonly unit: number;
  readonly hidden: boolean;
  /** Optional override for the pin-name label font size (mm). Falls back to
   *  KLC default 1.27 mm. */
  readonly nameFontSizeMm?: number;
  /** Optional override for the pin-number label font size (mm). */
  readonly numberFontSizeMm?: number;
}

export interface SymbolRenderSourceGraphic {
  readonly unit: number;
  readonly graphic: PreviewGraphic;
}

export interface SymbolRenderSourceLabel {
  readonly unit: number;
  readonly label: PreviewLabel;
}

export interface SymbolRenderSource {
  readonly name: string;
  readonly unitCount: number;
  readonly referenceText: string;
  readonly valueText: string;
  readonly pins: readonly SymbolRenderSourcePin[];
  readonly graphics: readonly SymbolRenderSourceGraphic[];
  readonly labels?: readonly SymbolRenderSourceLabel[];
  readonly warnings: readonly PreviewWarning[];
  /** Optional override for the symbol's reference-label font size (mm). */
  readonly referenceFontSizeMm?: number;
  /** Optional override for the symbol's value-label font size (mm). */
  readonly valueFontSizeMm?: number;
}

export interface SymbolRenderModelPin {
  readonly id: string;
  readonly name: string;
  readonly number: string | null;
  readonly electricalType: string;
  readonly unit: number;
  readonly anchor: PointMm;
  readonly bodyEnd: PointMm;
  readonly rotationDeg: number;
}

export interface SymbolRenderModel {
  readonly kind: "symbol";
  readonly units: "mm";
  readonly name: string;
  readonly unitCount: number;
  readonly graphics: readonly PreviewGraphic[];
  readonly pins: readonly SymbolRenderModelPin[];
  readonly labels: readonly PreviewLabel[];
  readonly bounds: BoundsMm | null;
  readonly warnings: readonly PreviewWarning[];
}

export interface FootprintRenderSourcePad {
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

export interface FootprintRenderSource {
  readonly name: string;
  readonly pads: readonly FootprintRenderSourcePad[];
  readonly graphics: readonly PreviewGraphic[];
  readonly labels: readonly PreviewLabel[];
  readonly warnings: readonly PreviewWarning[];
}

export interface FootprintRenderModel {
  readonly kind: "footprint";
  readonly units: "mm";
  readonly name: string;
  readonly pads: readonly FootprintRenderSourcePad[];
  readonly graphics: readonly PreviewGraphic[];
  readonly labels: readonly PreviewLabel[];
  readonly bounds: BoundsMm | null;
  readonly warnings: readonly PreviewWarning[];
}

export interface BuildSymbolRenderModelOptions {
  readonly composeAllUnits?: boolean;
  readonly includeHiddenPins?: boolean;
  readonly unitGapMm?: number;
  /** When true, do not left-align each unit's graphics to x=0. Use for live-drawn editors where the user's coordinates must be preserved. */
  readonly preserveOrigin?: boolean;
}

export interface BuildFootprintRenderModelOptions {
  readonly includeLayerNames?: readonly string[];
  readonly includePadLayerNames?: readonly string[];
  /** Reserved for live editors. Footprint builder currently preserves origin by default (no translation applied), so this is a semantic no-op — but it aligns the API with `BuildSymbolRenderModelOptions.preserveOrigin`. */
  readonly preserveOrigin?: boolean;
}
