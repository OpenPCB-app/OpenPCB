import type {
  LibraryComponent,
  LibraryComponentDetail,
  LibraryComponentPlacementDetail,
  LibraryFootprint,
  LibrarySearchParams,
  LibrarySymbol,
} from "./types";

export type {
  LibraryComponent,
  LibraryComponentDetail,
  LibraryComponentPlacementDetail,
  LibraryFootprint,
  LibraryFootprintDetail,
  LibraryFootprintPlacementSnapshot,
  LibraryPreviewWarning,
  LibrarySearchParams,
  LibrarySourceProvenance,
  LibrarySymbol,
  LibrarySymbolDetail,
  LibrarySymbolPinSnapshot,
  LibrarySymbolPlacementSnapshot,
} from "./types";

export interface LibrarySDK {
  resolveComponent(componentId: string): Promise<LibraryComponent | null>;
  getSymbol(symbolId: string): Promise<LibrarySymbol | null>;
  getFootprint(footprintId: string): Promise<LibraryFootprint | null>;
  getComponentDetail(componentId: string): Promise<LibraryComponentDetail | null>;
  searchComponents(params: LibrarySearchParams): Promise<LibraryComponent[]>;
  resolveComponentForPlacement(
    componentId: string,
  ): Promise<LibraryComponentPlacementDetail | null>;
}
