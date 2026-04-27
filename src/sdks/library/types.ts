import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../shared/rendering/types";

export interface LibraryComponent {
  id: string;
  name: string;
  description: string;
  symbolId: string;
  footprintId: string;
  tags: string[];
}

export interface LibrarySymbol {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface LibraryFootprint {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface LibraryPreviewWarning {
  code: string;
  message: string;
}

export interface LibrarySourceProvenance {
  sourceKind: string | null;
  sourceFormat: string | null;
  fileName: string | null;
  importedAt: string | null;
  sourceHash: string | null;
}

export interface LibrarySymbolDetail {
  id: string;
  name: string;
  referencePrefix: string | null;
  pinCount: number;
  warnings: LibraryPreviewWarning[];
  preview: Record<string, unknown> | null;
  provenance: LibrarySourceProvenance | null;
}

export interface LibraryFootprintDetail {
  id: string;
  name: string;
  mountType: string | null;
  padCount: number;
  packageCode: {
    imperial: string | null;
    metric: string | null;
  };
  warnings: LibraryPreviewWarning[];
  preview: Record<string, unknown> | null;
  provenance: LibrarySourceProvenance | null;
}

export interface LibraryComponentDetail {
  component: LibraryComponent;
  symbol: LibrarySymbolDetail;
  footprint: LibraryFootprintDetail;
}

export interface LibrarySymbolPinSnapshot {
  originPinKey: string;
  number: string | null;
  name: string;
  localPositionMm: {
    x: number;
    y: number;
  };
  electricalType: string;
  unit: number;
}

export interface LibrarySymbolPlacementSnapshot {
  symbolId: string;
  name: string;
  referencePrefix: string | null;
  sourceHash: string | null;
  pins: LibrarySymbolPinSnapshot[];
  preview: SymbolRenderModel;
}

export interface LibraryFootprintPlacementSnapshot {
  footprintId: string;
  name: string;
  mountType: string | null;
  sourceHash: string | null;
  preview: FootprintRenderModel | null;
}

export interface LibraryComponentPlacementDetail {
  component: LibraryComponent;
  symbol: LibrarySymbolPlacementSnapshot;
  footprint: LibraryFootprintPlacementSnapshot;
  resolvedAt: string;
}

export interface LibrarySearchParams {
  query?: string;
  limit?: number;
  tags?: string[];
}
