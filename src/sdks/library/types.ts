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
  isBuiltin: boolean;
  /** Assembly sourcing, inherited onto a placement's BOM data. Null when unknown. */
  manufacturer?: string | null;
  manufacturerPartNumber?: string | null;
  lcscPartNumber?: string | null;
  supplier?: string | null;
  /** Pack metadata (opclib-pack >= 0.3.0). Null for older packs. */
  subcategory?: string | null;
  datasheetUrl?: string | null;
  keywords?: string[];
  /**
   * Where this component came from: for a "Duplicate to edit" copy, the source
   * part (`origin.componentId !== id`); for a pack component, itself. Null for
   * parts created locally (KiCad import, drawn, generated).
   */
  origin?: LibraryComponentOrigin | null;
  /**
   * Mount style of the component's default footprint, normalised for display.
   * Populated by the component-list DTO only (the detail payload carries the
   * authoritative `footprint.mountType`). `null` when the component has no
   * resolvable footprint or its blob carries no recognised mount value.
   */
  mountType?: LibraryMountType | null;
  /**
   * Pad count of the component's default footprint. Same provenance rules as
   * `mountType`: list DTO only, `null` when unresolvable.
   */
  padCount?: number | null;
}

export interface LibraryComponentOrigin {
  /** Source library id, e.g. `openpcb.core`. */
  libraryId: string;
  componentId: string;
  componentVersion: string | null;
}

/** Display forms of a footprint mount style (list DTO). */
export type LibraryMountType = "SMD" | "THT" | "Mixed";

export interface LibraryPinMapEntry {
  pinNumber: string;
  padNumber: string;
  pinName: string | null;
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

/** One row of `library_component_footprints` enriched with display metadata. */
export interface LibraryComponentFootprintVariant {
  footprintId: string;
  variantLabel: string;
  isDefault: boolean;
  sortOrder: number;
  /** Cached subset of LibraryFootprintDetail useful for picker UIs. */
  name: string;
  mountType: string | null;
  padCount: number;
  packageCode: {
    imperial: string | null;
    metric: string | null;
  };
  /** Explicit symbol-pin → footprint-pad map. Null means fallback to matching numbers. */
  pinMap: LibraryPinMapEntry[] | null;
}

export interface LibraryComponentDetail {
  component: LibraryComponent;
  symbol: LibrarySymbolDetail;
  /** The currently-resolved footprint detail (default unless overridden). */
  footprint: LibraryFootprintDetail;
  /**
   * Every footprint this component can accept. Always non-empty (length >= 1)
   * for resolvable components; the entry whose `footprintId` matches
   * `component.footprintId` is the default.
   */
  footprintVariants: LibraryComponentFootprintVariant[];
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

export type LibraryFootprintModelStatus =
  | "missing"
  | "pending_client_conversion"
  | "ready"
  | "failed"
  | "unsupported_format";

export interface LibraryFootprintModelDescriptor {
  status: LibraryFootprintModelStatus | string;
  glbUrl: string | null;
  glbSha256: string | null;
  sourceStepSha256: string | null;
  sourceFilename: string | null;
  modelRef: unknown | null;
  converterVersion: string | null;
}

export interface LibraryFootprintPlacementSnapshot {
  footprintId: string;
  name: string;
  mountType: string | null;
  sourceHash: string | null;
  preview: FootprintRenderModel | null;
  /** Component-specific symbol-pin → footprint-pad map. Missing/null means fallback to matching numbers. */
  pinMap?: LibraryPinMapEntry[] | null;
  model3d?: LibraryFootprintModelDescriptor;
}

export interface LibraryComponentPlacementDetail {
  component: LibraryComponent;
  symbol: LibrarySymbolPlacementSnapshot;
  footprint: LibraryFootprintPlacementSnapshot;
  /**
   * All footprints this component can accept. Used by per-instance footprint
   * pickers in the schematic / PCB property panels.
   */
  footprintVariants: LibraryComponentFootprintVariant[];
  resolvedAt: string;
}

export interface LibrarySearchParams {
  query?: string;
  /** Page size, clamped to [1, 200]; default 25. */
  limit?: number;
  /** Rows to skip in the stable list order; default 0. */
  offset?: number;
  tags?: string[];
}

/**
 * One page of `GET /components`. `total` counts every match of the query +
 * tag filters and equals `LibraryFacets.total` for the same parameters.
 * Order is stable (exact name, name prefix, name contains, other; then name,
 * then id), so `offset` paging never skips or repeats a row.
 */
export interface LibraryComponentPage {
  components: LibraryComponent[];
  total: number;
  offset: number;
  limit: number;
}

export interface LibraryTagStat {
  tag: string;
  count: number;
}

export type LibraryFacetBucket =
  | "source"
  | "family"
  | "package"
  | "mount"
  | "other";

export interface LibraryFacetOption {
  /** Tag value to send back as a filter (lower-case, kebab). */
  key: string;
  /** Display label. Same as `key` for tag-based facets; humanised for source. */
  label: string;
  count: number;
}

export interface LibraryFacets {
  source: LibraryFacetOption[];
  family: LibraryFacetOption[];
  package: LibraryFacetOption[];
  mount: LibraryFacetOption[];
  other: LibraryFacetOption[];
  /** Components matching the full active filter set (query + every facet). */
  total: number;
}

export interface LibraryFacetParams {
  query?: string;
  /** Flat list of currently-active tag filters; bucketed server-side. */
  tags?: string[];
}

export interface LibraryListTagsOptions {
  excludeSystem?: boolean;
}

export interface LibraryUpdateComponentInput {
  name?: string;
  description?: string;
  tags?: string[];
}
