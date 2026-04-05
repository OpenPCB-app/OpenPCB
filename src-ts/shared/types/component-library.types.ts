export type ComponentScope = "workspace" | "builtin";

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
}

export interface ComponentFootprint {
  id: string;
  variantId: string;
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
  componentId: string;
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
  defaultFootprintOptionId: string | null;
}

export interface Component {
  id: string;
  canonicalKey: string;
  displayLabel: string;
  description: string;
  scope: ComponentScope;
  symbolData: SymbolData;
  variants: ComponentVariant[];
  defaultVariantId: string | null;
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
  componentId: string | null;
  wizardStep: number;
  payload: Partial<Component>;
  warnings: unknown[];
  createdAt: string;
  updatedAt: string;
}
