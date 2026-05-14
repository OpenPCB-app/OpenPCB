import type {
  LibraryComponent,
  LibraryComponentDetail,
  LibraryComponentPlacementDetail,
  LibraryFootprint,
  LibraryListTagsOptions,
  LibrarySearchParams,
  LibrarySymbol,
  LibraryTagStat,
  LibraryUpdateComponentInput,
} from "./types";

export type {
  LibraryComponent,
  LibraryComponentDetail,
  LibraryComponentPlacementDetail,
  LibraryFootprint,
  LibraryFootprintDetail,
  LibraryFootprintModelDescriptor,
  LibraryFootprintModelStatus,
  LibraryFootprintPlacementSnapshot,
  LibraryComponentFootprintVariant,
  LibraryListTagsOptions,
  LibraryPinMapEntry,
  LibraryPreviewWarning,
  LibrarySearchParams,
  LibrarySourceProvenance,
  LibrarySymbol,
  LibrarySymbolDetail,
  LibrarySymbolPinSnapshot,
  LibrarySymbolPlacementSnapshot,
  LibraryTagStat,
  LibraryUpdateComponentInput,
} from "./types";

export interface LibrarySDK {
  resolveComponent(componentId: string): Promise<LibraryComponent | null>;
  getSymbol(symbolId: string): Promise<LibrarySymbol | null>;
  getFootprint(footprintId: string): Promise<LibraryFootprint | null>;
  getComponentDetail(
    componentId: string,
  ): Promise<LibraryComponentDetail | null>;
  searchComponents(params: LibrarySearchParams): Promise<LibraryComponent[]>;
  resolveComponentForPlacement(
    componentId: string,
  ): Promise<LibraryComponentPlacementDetail | null>;
  listTags(options?: LibraryListTagsOptions): Promise<LibraryTagStat[]>;
  updateComponent(
    componentId: string,
    patch: LibraryUpdateComponentInput,
  ): Promise<LibraryComponent | null>;
}
