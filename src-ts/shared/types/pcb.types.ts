export type PcbProjectDocumentFormatVersion = "pcb.project-document/v1";
export type SchematicProjectDocumentFormatVersion =
  "pcb.schematic-project-document/v1";
export type LibraryProjectDocumentFormatVersion =
  "pcb.library-project-document/v1";
export type ManufacturingProjectDocumentFormatVersion =
  "pcb.manufacturing-project-document/v1";
export type ProjectDocumentBundleFormatVersion =
  "pcb.project-document-bundle/v1";

export interface ProjectDocumentId {
  id: string;
  projectId: string;
  updatedAt: string;
  version: number;
}

export interface ProjectPoint {
  x: number;
  y: number;
}

export interface ProjectRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectPolyline {
  points: ProjectPoint[];
}

export interface SchematicSymbolPin {
  id: string;
  name: string;
  position: ProjectPoint;
}

export interface SchematicSymbol {
  id: string;
  componentId?: string | null;
  variantId?: string | null;
  /** @deprecated Use componentId instead. Kept for backward compatibility with old documents. */
  libraryPartId?: string | null;
  reference?: string | null;
  position: ProjectPoint;
  rotation?: number;
  pins: SchematicSymbolPin[];
  properties?: Record<string, string>;
}

export interface SchematicWire {
  id: string;
  points: ProjectPoint[];
  sourcePinId: string;
  targetPinId: string;
  net?: string | null;
}

export interface SchematicLabel {
  id: string;
  text: string;
  position: ProjectPoint;
  rotation?: number;
  net?: string | null;
}

export interface SchematicProjectDocument extends ProjectDocumentId {
  formatVersion: SchematicProjectDocumentFormatVersion;
  title?: string;
  symbols: SchematicSymbol[];
  wires: SchematicWire[];
  labels: SchematicLabel[];
}

export interface PcbBoardOutline {
  width: number;
  height: number;
}

export interface PcbNetClass {
  name: string;
  traceWidth: number;
  clearance: number;
  viaDiameter: number;
  viaDrill: number;
}

export interface PcbPadReference {
  componentId: string;
  padNumber: string;
}

export interface PcbNet {
  id: string;
  name: string;
  netClass: string;
  padRefs: PcbPadReference[];
}

export interface PcbPlacement {
  id: string;
  schematicSymbolId: string;
  componentId: string;
  variantId: string;
  footprintOptionId: string;
  reference: string;
  value: string;
  position: ProjectPoint;
  rotation: number;
  layer: "F.Cu" | "B.Cu";
  footprintData: unknown;
}

export interface PcbTrace {
  id: string;
  start: ProjectPoint;
  end: ProjectPoint;
  width: number;
  layer: string;
  net: string;
}

export interface PcbVia {
  id: string;
  position: ProjectPoint;
  padDiameter: number;
  drillDiameter: number;
  net: string;
  type: "through";
  layers: [string, string];
  tented: boolean;
}

export interface PcbProjectDocument extends ProjectDocumentId {
  formatVersion: PcbProjectDocumentFormatVersion;
  boardOutline: PcbBoardOutline;
  manufacturerPreset: string;
  netClasses: PcbNetClass[];
  nets: PcbNet[];
  placements: PcbPlacement[];
  traces: PcbTrace[];
  vias: PcbVia[];
  zones: Array<{
    id: string;
    net: string;
    layer: string;
    priority: number;
    outline: ProjectPoint[];
    fillType: "solid" | "hatched" | "none";
    clearance: number;
    minWidth: number;
    padConnection: "thermal" | "direct" | "none";
  }>;
}

export interface LibraryPartReference {
  id: string;
  partNumber?: string | null;
  manufacturer?: string | null;
  footprintId?: string | null;
  schematicSymbolId?: string | null;
}

export interface LibraryProjectDocument extends ProjectDocumentId {
  formatVersion: LibraryProjectDocumentFormatVersion;
  parts: LibraryPartReference[];
}

export type ManufacturingOutputFormat =
  | "gerber"
  | "drill"
  | "pick-and-place"
  | "bom";

export interface ManufacturingExportMetadata {
  exportedAt: string;
  format: ManufacturingOutputFormat;
  outputPath?: string | null;
  revision?: string | null;
}

export interface ManufacturingProjectDocument extends ProjectDocumentId {
  formatVersion: ManufacturingProjectDocumentFormatVersion;
  settings: {
    outputUnits?: "mm" | "mil";
    includeAssembly?: boolean;
    includeFabrication?: boolean;
    notes?: string;
  };
  lastExport?: ManufacturingExportMetadata | null;
}

export interface ProjectDocumentBundle {
  formatVersion: ProjectDocumentBundleFormatVersion;
  docs: {
    schematic?: SchematicProjectDocument | null;
    pcb?: PcbProjectDocument | null;
    library?: LibraryProjectDocument | null;
    manufacturing?: ManufacturingProjectDocument | null;
  };
}
