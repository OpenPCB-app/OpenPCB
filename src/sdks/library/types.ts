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
}

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
  limit?: number;
  tags?: string[];
}
