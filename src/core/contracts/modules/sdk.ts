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

export interface LibrarySearchParams {
  query?: string;
  limit?: number;
  tags?: string[];
}

export interface LibrarySDK {
  resolveComponent(componentId: string): Promise<LibraryComponent | null>;
  getSymbol(symbolId: string): Promise<LibrarySymbol | null>;
  getFootprint(footprintId: string): Promise<LibraryFootprint | null>;
  searchComponents(params: LibrarySearchParams): Promise<LibraryComponent[]>;
}
