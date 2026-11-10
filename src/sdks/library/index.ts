import type {
  LibraryAddComponentFootprintInput,
  LibraryDefaultFootprintRef,
  LibraryFootprintPlacementSnapshot,
  LibraryFootprintQualification,
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
  FootprintGenerationStamp,
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
  LibraryFootprintQualification,
  LibraryFootprintQualificationStatus,
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
  /** Generator qualification of stored footprint rows; unknown ids are absent. */
  getFootprintQualifications(
    footprintIds: readonly string[],
  ): Promise<Record<string, LibraryFootprintQualification>>;
  /**
   * Generator qualification of placed footprints, classified from each
   * snapshot's own pads (the geometry the Gerber writes), keyed by `key`.
   */
  classifyPlacedFootprints(
    items: readonly {
      key: string;
      snapshot: LibraryFootprintPlacementSnapshot;
    }[],
  ): Promise<Record<string, LibraryFootprintQualification>>;
}
