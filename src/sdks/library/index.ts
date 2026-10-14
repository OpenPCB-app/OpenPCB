import type {
  LibraryAddComponentFootprintInput,
  LibraryDefaultFootprintRef,
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
  LibraryAddComponentFootprintInput,
  LibraryAuthoredFootprintSource,
  LibraryDefaultFootprintRef,
  LibraryComponent,
  LibraryComponentDetail,
  LibraryComponentOrigin,
  LibraryComponentPage,
  LibraryComponentPlacementDetail,
  LibraryFacets,
  LibraryFacetBucket,
  LibraryFacetOption,
  LibraryFacetParams,
  LibraryFootprint,
  LibraryFootprintDetail,
  LibraryFootprintModelDescriptor,
  LibraryFootprintModelStatus,
  LibraryFootprintPlacementSnapshot,
  LibraryComponentFootprintVariant,
  LibraryListTagsOptions,
  LibraryMountType,
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
  /**
   * Create a generated/drawn footprint for an existing user component and link
   * it (default: as the component default). Null when the component is missing.
   */
  addComponentFootprint(
    componentId: string,
    input: LibraryAddComponentFootprintInput,
  ): Promise<{ footprintId: string } | null>;
  /** Batch default-footprint refs; unknown component ids are absent. */
  getDefaultFootprintRefs(
    componentIds: readonly string[],
  ): Promise<Record<string, LibraryDefaultFootprintRef>>;
}
