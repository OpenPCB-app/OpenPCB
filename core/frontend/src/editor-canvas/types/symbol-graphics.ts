import type { Nanometers, Vec2 } from "../coords";

export type PinSide = "left" | "right" | "top" | "bottom";

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
  points: Vec2[];
  filled: boolean;
  closed: boolean;
  strokeWidth: number;
}

export interface BezierGraphic extends GraphicBase {
  type: "bezier";
  points: [Vec2, Vec2, Vec2, Vec2];
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
