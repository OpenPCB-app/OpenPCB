/**
 * Public SDK contracts modules implement or consume via ctx.sdk.
 */

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

export interface LibrarySearchParams {
  query?: string;
  limit?: number;
  tags?: string[];
}

export interface LibrarySDK {
  resolveComponent(componentId: string): Promise<LibraryComponent | null>;
  getSymbol(symbolId: string): Promise<LibrarySymbol | null>;
  getFootprint(footprintId: string): Promise<LibraryFootprint | null>;
  getComponentDetail(componentId: string): Promise<LibraryComponentDetail | null>;
  searchComponents(params: LibrarySearchParams): Promise<LibraryComponent[]>;
}
