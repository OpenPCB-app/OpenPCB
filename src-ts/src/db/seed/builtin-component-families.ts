import { v7 as uuidv7 } from "uuid";

interface PinDef {
  name: string;
  electricalType:
    | "passive"
    | "input"
    | "output"
    | "bidirectional"
    | "power_in"
    | "power_out"
    | "open_collector"
    | "open_emitter"
    | "unspecified";
}

interface ComponentFamilySeed {
  canonicalKey: string;
  displayLabel: string;
  description: string;
  categoryPath: string;
  tags: string[];
  referencePrefix: string;
  pinDefinitions: PinDef[];
  defaultValue: string;
}

/**
 * Built-in component families.
 * NOTE: All physical components are now external. Only GND and VCC power
 * symbols remain as embedded symbols (defined in symbol-library.ts).
 */
const BUILTIN_FAMILIES: ComponentFamilySeed[] = [];

export interface ComponentFamilySeedRow {
  id: string;
  canonicalKey: string;
  displayLabel: string;
  description: string;
  scope: "built_in";
  symbolData: {
    referencePrefix: string;
    pinDefinitions: PinDef[];
    properties: Record<string, string>;
    unitCount: number;
    bodyGraphics: unknown[];
    rawKicadSource: null;
  };
  defaultPackageVariantId: null;
  categoryPath: string;
  tags: string[];
}

export function generateBuiltinComponentFamilySeed(): ComponentFamilySeedRow[] {
  return BUILTIN_FAMILIES.map((family) => ({
    id: uuidv7(),
    canonicalKey: family.canonicalKey,
    displayLabel: family.displayLabel,
    description: family.description,
    scope: "built_in" as const,
    symbolData: {
      referencePrefix: family.referencePrefix,
      pinDefinitions: family.pinDefinitions,
      properties: { value: family.defaultValue },
      unitCount: 1,
      bodyGraphics: [],
      rawKicadSource: null,
    },
    defaultPackageVariantId: null,
    categoryPath: family.categoryPath,
    tags: family.tags,
  }));
}
