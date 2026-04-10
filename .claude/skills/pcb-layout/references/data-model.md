# PCB Data Model — Complete Reference

## Core types

```typescript
interface Point2D {
  x: number;  // mm
  y: number;  // mm
}

interface BoardOutline {
  width: number;   // mm
  height: number;  // mm
}

interface NetClass {
  name: string;            // "Default", "Power"
  traceWidth: number;      // mm
  clearance: number;       // mm
  viaDiameter: number;     // mm
  viaDrill: number;        // mm
}

interface PcbNet {
  id: string;
  name: string;            // "GND", "VCC", "Net_1"
  netClass: string;        // references NetClass.name
  padRefs: PadReference[];
}

interface PadReference {
  componentId: string;     // PcbPlacement.id
  padNumber: string;       // "1", "2"
}

interface PcbPlacement {
  id: string;
  schematicSymbolId: string;
  componentId: string;
  variantId: string;
  footprintOptionId: string;
  reference: string;       // "R1", "C3"
  value: string;           // "10k"
  position: Point2D;       // mm
  rotation: number;        // degrees
  layer: "F.Cu" | "B.Cu";
  footprintData: ParsedKicadFootprint;
}

interface TraceSegment {
  id: string;
  start: Point2D;
  end: Point2D;
  width: number;           // mm
  layer: string;           // "F.Cu" or "B.Cu"
  net: string;             // net ID
}

interface Via {
  id: string;
  position: Point2D;
  padDiameter: number;     // mm
  drillDiameter: number;   // mm
  net: string;
  type: "through";
  layers: [string, string];
  tented: boolean;
}

interface CopperZone {
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

interface PcbDocument {
  boardOutline: BoardOutline;
  manufacturerPreset: string;
  netClasses: NetClass[];
  nets: PcbNet[];
  placements: PcbPlacement[];
  traces: TraceSegment[];
  vias: Via[];
  zones: CopperZone[];
}
```

## Parsed footprint structure (from KiCad)

```typescript
interface ParsedKicadFootprint {
  name: string;
  description: string;
  tags: string[];
  pads: ParsedPad[];
  graphics: ParsedGraphic[];
  model3dRefs: Model3DRef[];
  attributes: { type: "smd" | "through_hole" };
  warnings: Array<{ code: string; message: string }>;
  rawSource: string;
}

interface ParsedPad {
  number: string;
  type: "smd" | "thru_hole" | "np_thru_hole" | "connect";
  shape: "circle" | "rect" | "oval" | "roundrect" | "trapezoid" | "custom";
  position: { x: number; y: number };  // mm, relative to footprint origin
  size: { width: number; height: number };
  rotation: number;
  layers: string[];
  roundrectRatio?: number;
  drillDiameter?: number;
  drillOffset?: { x: number; y: number };
}

interface ParsedGraphic {
  type: "line" | "rect" | "circle" | "arc" | "poly" | "text";
  layer: string;
  data: Record<string, unknown>;
  // Line: { start: [x,y], end: [x,y], width: number }
  // Circle: { center: [x,y], radius: number, width: number }
  // Text: { at: [x,y], __args: [type, content] }
}
```

## Persistence format

PCB data is persisted as part of `ProjectDocumentBundle`:

```typescript
interface ProjectDocumentBundle {
  formatVersion: string;
  docs: {
    schematic: SchematicProjectDocument | null;
    pcb: PcbDocument | null;
    library?: any;
    manufacturing?: any;
  };
}
```

Stored in `design_sheet.content` column. Load path auto-detects old format (schematic-only) vs bundle.
