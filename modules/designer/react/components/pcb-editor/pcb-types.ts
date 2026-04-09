import type { ParsedKicadFootprint } from "@/lib/api/component-api";

export interface Point2D {
  x: number;
  y: number;
}

export interface NetClass {
  name: string;
  traceWidth: number;
  clearance: number;
  viaDiameter: number;
  viaDrill: number;
}

export interface PadReference {
  componentId: string;
  padNumber: string;
}

export interface PcbNet {
  id: string;
  name: string;
  netClass: string;
  padRefs: PadReference[];
}

export interface PcbPlacement {
  id: string;
  schematicSymbolId: string;
  componentId: string;
  variantId: string;
  footprintOptionId: string;
  reference: string;
  value: string;
  position: Point2D;
  rotation: number;
  layer: "F.Cu" | "B.Cu";
  footprintData: ParsedKicadFootprint;
}

export interface TraceSegment {
  id: string;
  start: Point2D;
  end: Point2D;
  width: number;
  layer: string;
  net: string;
}

export interface Via {
  id: string;
  position: Point2D;
  padDiameter: number;
  drillDiameter: number;
  net: string;
  type: "through";
  layers: [string, string];
  tented: boolean;
}

export interface CopperZone {
  id: string;
  net: string;
  layer: string;
  priority: number;
  outline: Point2D[];
  fillType: "solid" | "hatched" | "none";
  clearance: number;
  minWidth: number;
  padConnection: "thermal" | "direct" | "none";
}

export interface BoardOutline {
  width: number;
  height: number;
}

export interface PcbDocument {
  boardOutline: BoardOutline;
  manufacturerPreset: string;
  netClasses: NetClass[];
  nets: PcbNet[];
  placements: PcbPlacement[];
  traces: TraceSegment[];
  vias: Via[];
  zones: CopperZone[];
}

export interface RatsnestLine {
  start: Point2D;
  end: Point2D;
  netId: string;
}

export interface PcbViewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export function createDefaultBoardOutline(): BoardOutline {
  return { width: 100, height: 100 };
}

export function createDefaultNetClass(): NetClass {
  return {
    name: "Default",
    traceWidth: 0.25,
    clearance: 0.2,
    viaDiameter: 0.6,
    viaDrill: 0.3,
  };
}

export function createEmptyPcbDocument(): PcbDocument {
  return {
    boardOutline: createDefaultBoardOutline(),
    manufacturerPreset: "jlcpcb_standard",
    netClasses: [],
    nets: [],
    placements: [],
    traces: [],
    vias: [],
    zones: [],
  };
}

export function createDefaultPcbViewport(): PcbViewport {
  return { offsetX: 0, offsetY: 0, zoom: 1 };
}
