export type PcbProjectDocumentFormatVersion = "pcb.project-document/v1";
export type SchematicProjectDocumentFormatVersion = "pcb.schematic-project-document/v1";
export type LibraryProjectDocumentFormatVersion = "pcb.library-project-document/v1";
export type ManufacturingProjectDocumentFormatVersion = "pcb.manufacturing-project-document/v1";
export type ProjectDocumentBundleFormatVersion = "pcb.project-document-bundle/v1";

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
  libraryPartId?: string | null;
  symbolTemplate?: string | null;
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
  id: string;
  outline: ProjectPolyline;
  keepoutAreas?: ProjectRect[];
  thicknessMm?: number;
}

export interface PcbFootprintPad {
  id: string;
  name: string;
  position: ProjectPoint;
  size: ProjectRect;
}

export interface PcbFootprint {
  id: string;
  symbolId?: string | null;
  libraryPartId?: string | null;
  reference?: string | null;
  position: ProjectPoint;
  rotation?: number;
  pads: PcbFootprintPad[];
}

export interface PcbTrace {
  id: string;
  net?: string | null;
  width: number;
  layer: string;
  points: ProjectPoint[];
}

export interface PcbVia {
  id: string;
  net?: string | null;
  position: ProjectPoint;
  drillDiameter: number;
  diameter: number;
  layerFrom: string;
  layerTo: string;
}

export interface PcbDesignRules {
  defaultTraceWidthMm?: number;
  defaultViaDiameterMm?: number;
  defaultViaDrillMm?: number;
  clearanceMm?: number;
}

export interface PcbProjectDocument extends ProjectDocumentId {
  formatVersion: PcbProjectDocumentFormatVersion;
  board: PcbBoardOutline;
  footprints: PcbFootprint[];
  traces: PcbTrace[];
  vias: PcbVia[];
  rules?: PcbDesignRules;
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

export type ManufacturingOutputFormat = "gerber" | "drill" | "pick-and-place" | "bom";

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
