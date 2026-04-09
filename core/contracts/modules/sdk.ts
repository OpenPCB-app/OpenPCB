export interface ComponentLibraryPart {
  id: string;
  name: string;
  description: string;
  symbolId: string;
  footprintId: string;
  tags: string[];
}

export interface ComponentLibrarySymbol {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface ComponentLibraryFootprint {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface ComponentLibrarySearchParams {
  query?: string;
  limit?: number;
  tags?: string[];
}

export interface ComponentLibrarySDK {
  resolvePart(partId: string): Promise<ComponentLibraryPart | null>;
  getSymbol(symbolId: string): Promise<ComponentLibrarySymbol | null>;
  getFootprint(footprintId: string): Promise<ComponentLibraryFootprint | null>;
  searchParts(params: ComponentLibrarySearchParams): Promise<ComponentLibraryPart[]>;
}

export interface AIServiceSDK {
  complete(params: { prompt: string }): Promise<string>;
  embed(text: string): Promise<number[]>;
}
