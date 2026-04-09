/**
 * Public SDK contracts modules implement or consume via ctx.sdk.
 *
 * Each SDK represents a stable, cross-module public API for a given
 * feature module. Implementations live inside their owning module's
 * backend and are registered with the sdk registry during activation.
 */

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
  searchParts(
    params: ComponentLibrarySearchParams,
  ): Promise<ComponentLibraryPart[]>;
}
