export type ComponentScope = "workspace";

export type MountType = "smd" | "through_hole" | "virtual";

export type PinElectricalType =
  | "passive"
  | "input"
  | "output"
  | "bidirectional"
  | "power_in"
  | "power_out"
  | "open_collector"
  | "open_emitter"
  | "unspecified";

export type DensityLevel = "most" | "nominal" | "least";

export interface PinDefinition {
  name: string;
  electricalType: PinElectricalType;
}

export interface SymbolData {
  referencePrefix: string;
  pinDefinitions: PinDefinition[];
  properties: Record<string, string>;
  unitCount: number;
  bodyGraphics: unknown[];
  rawKicadSource?: string | null;
  symbolTemplate?: string | null;
}

export interface ComponentFootprint {
  id: string;
  footprint_id?: string;
  variantId: string;
  variant_id?: string;
  label: string;
  isDefault: boolean;
  kicadPayload: unknown | null;
  model3dOptions?: Array<{
    id: string;
    fileName: string;
    stepAssetPath: string | null;
    isDefault?: boolean;
  }>;
  densityLevel?: DensityLevel | null;
  ipcName?: string | null;
}

export interface ComponentVariant {
  id: string;
  variant_id?: string;
  familyId: string;
  component_id?: string;
  canonicalCode: string;
  humanLabel: string;
  imperialAlias: string | null;
  metricAlias: string | null;
  mountType: MountType;
  dimensions: {
    lengthMm: number;
    widthMm: number;
    heightMm: number | null;
  } | null;
  isDefault: boolean;
  pinRemapTable: Record<string, string> | null;
  footprintOptions: ComponentFootprint[];
  footprints?: ComponentFootprint[];
  defaultFootprintOptionId: string | null;
  defaultFootprintId?: string | null;
}

export interface Component {
  id: string;
  component_id?: string;
  canonicalKey: string;
  displayLabel: string;
  description: string;
  scope: ComponentScope;
  symbolData: SymbolData;
  packageVariants: ComponentVariant[];
  variants?: ComponentVariant[];
  defaultPackageVariantId: string | null;
  defaultVariantId?: string | null;
  categoryPath: string | null;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ComponentReference {
  component_id: string;
  variant_id: string;
  footprint_id: string | null;
  reference?: string;
}

export interface ComponentWorkspaceRecord {
  id: string;
  familyId: string | null;
  wizardStep: number;
  payload: Partial<Component>;
  warnings: unknown[];
  createdAt: string;
  updatedAt: string;
}
