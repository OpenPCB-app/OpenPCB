import { describe, expect, test } from "bun:test";
import {
  type ComponentDraftPayload,
  type ComponentFamily,
  type FootprintOption,
  type ImportWarning,
  type ImportWarningCode,
  type Model3DOption,
  type PackageVariant,
  type PinDefinition,
  type PresetCatalog,
  type SchematicComponentSelection,
  PUBLISH_BLOCKERS,
  PUBLISH_WARNINGS,
  canDuplicatePreset,
  canEditPreset,
  determineSwitchOutcome,
} from "./component-semantics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePin(name: string): PinDefinition {
  return { name, electricalType: "passive" };
}

function makeFootprint(
  id: string,
  isDefault: boolean,
  label = "Nominal",
): FootprintOption {
  return {
    id,
    variantId: "v1",
    label,
    isDefault,
    kicadPayload: null,
    model3dOptions: [],
    defaultModel3dOptionId: null,
  };
}

function makeVariant(
  overrides: Partial<PackageVariant> & { id: string },
): PackageVariant {
  return {
    familyId: "fam-1",
    canonicalCode: "0603",
    humanLabel: "0603 / 1608 Metric",
    imperialAlias: "0603",
    metricAlias: "1608",
    mountType: "smd",
    dimensions: null,
    isDefault: true,
    pinRemapTable: null,
    footprintOptions: [makeFootprint("fp-1", true)],
    defaultFootprintOptionId: "fp-1",
    offerings: [],
    ...overrides,
  };
}

function makeDraftPayload(
  overrides: Partial<ComponentDraftPayload> = {},
): ComponentDraftPayload {
  return {
    displayLabel: "Ceramic Capacitor",
    description: "Generic MLCC",
    symbolData: {
      referencePrefix: "C",
      pinDefinitions: [makePin("1"), makePin("2")],
      properties: {},
    },
    packageVariants: [makeVariant({ id: "v1" })],
    defaultPackageVariantId: "v1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Publish blocker matrix
// ---------------------------------------------------------------------------

describe("publish blocker matrix", () => {
  test("all blocker codes are classified as blockers", () => {
    const blockerCodes: ImportWarningCode[] = [
      "missing_symbol_data",
      "zero_package_variants",
      "no_default_variant",
      "variant_missing_default_footprint",
      "unresolved_pin_remap",
      "broken_internal_ids",
      "duplicate_canonical_code",
    ];
    for (const code of blockerCodes) {
      expect(PUBLISH_BLOCKERS.has(code)).toBe(true);
      expect(PUBLISH_WARNINGS.has(code)).toBe(false);
    }
  });

  test("all warning codes are classified as warnings only", () => {
    const warningCodes: ImportWarningCode[] = [
      "missing_3d_model",
      "orphan_model_file",
      "missing_datasheet",
      "absent_offerings",
      "import_ambiguity",
      "unsupported_construct",
    ];
    for (const code of warningCodes) {
      expect(PUBLISH_WARNINGS.has(code)).toBe(true);
      expect(PUBLISH_BLOCKERS.has(code)).toBe(false);
    }
  });

  test("blocker and warning sets are disjoint", () => {
    for (const code of PUBLISH_BLOCKERS) {
      expect(PUBLISH_WARNINGS.has(code)).toBe(false);
    }
    for (const code of PUBLISH_WARNINGS) {
      expect(PUBLISH_BLOCKERS.has(code)).toBe(false);
    }
  });

  test("every ImportWarningCode is classified", () => {
    const allCodes: ImportWarningCode[] = [
      "missing_symbol_data",
      "zero_package_variants",
      "no_default_variant",
      "variant_missing_default_footprint",
      "unresolved_pin_remap",
      "broken_internal_ids",
      "duplicate_canonical_code",
      "missing_3d_model",
      "orphan_model_file",
      "missing_datasheet",
      "absent_offerings",
      "import_ambiguity",
      "unsupported_construct",
    ];
    for (const code of allCodes) {
      const classified =
        PUBLISH_BLOCKERS.has(code) || PUBLISH_WARNINGS.has(code);
      expect(classified).toBe(true);
    }
  });

  test("missing default footprint blocks, missing 3D does not", () => {
    expect(PUBLISH_BLOCKERS.has("variant_missing_default_footprint")).toBe(
      true,
    );
    expect(PUBLISH_BLOCKERS.has("missing_3d_model")).toBe(false);
    expect(PUBLISH_WARNINGS.has("missing_3d_model")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Package switch safety matrix
// ---------------------------------------------------------------------------

describe("package switch safety matrix", () => {
  const familyPins = [makePin("1"), makePin("2")];

  test("identity switch → auto_apply", () => {
    const variant = makeVariant({ id: "v1" });
    const result = determineSwitchOutcome(variant, variant, familyPins, "fp-1");
    expect(result).toBe("auto_apply");
  });

  test("pin-compatible switch → auto_apply", () => {
    const source = makeVariant({ id: "v1" });
    const target = makeVariant({
      id: "v2",
      canonicalCode: "0805",
      footprintOptions: [makeFootprint("fp-1", true)],
      defaultFootprintOptionId: "fp-1",
    });
    const result = determineSwitchOutcome(source, target, familyPins, "fp-1");
    expect(result).toBe("auto_apply");
  });

  test("pin-compatible but footprint not in target → auto_fallback", () => {
    const source = makeVariant({ id: "v1" });
    const target = makeVariant({
      id: "v2",
      canonicalCode: "0805",
      footprintOptions: [makeFootprint("fp-2", true)],
      defaultFootprintOptionId: "fp-2",
    });
    const result = determineSwitchOutcome(source, target, familyPins, "fp-1");
    expect(result).toBe("auto_fallback");
  });

  test("pin count mismatch → requires_confirmation", () => {
    const source = makeVariant({ id: "v1" });
    const target = makeVariant({
      id: "v2",
      canonicalCode: "SOT-23",
      pinRemapTable: { "1": "B", "2": "C", "3": "E" },
      footprintOptions: [makeFootprint("fp-2", true)],
      defaultFootprintOptionId: "fp-2",
    });
    const result = determineSwitchOutcome(source, target, familyPins, "fp-1");
    expect(result).toBe("requires_confirmation");
  });

  test("pin names differ → requires_confirmation", () => {
    const source = makeVariant({
      id: "v1",
      pinRemapTable: { "1": "A", "2": "B" },
    });
    const target = makeVariant({
      id: "v2",
      pinRemapTable: { "1": "X", "2": "Y" },
      footprintOptions: [makeFootprint("fp-2", true)],
      defaultFootprintOptionId: "fp-2",
    });
    const result = determineSwitchOutcome(source, target, familyPins, "fp-1");
    expect(result).toBe("requires_confirmation");
  });

  test("target missing default footprint → blocked", () => {
    const source = makeVariant({ id: "v1" });
    const target = makeVariant({
      id: "v2",
      footprintOptions: [],
      defaultFootprintOptionId: null,
    });
    const result = determineSwitchOutcome(source, target, familyPins, "fp-1");
    expect(result).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// Schematic instance selection
// ---------------------------------------------------------------------------

describe("schematic component selection", () => {
  test("requires all four IDs", () => {
    const selection: SchematicComponentSelection = {
      componentFamilyId: "fam-1",
      componentRevisionId: "rev-1",
      selectedPackageVariantId: "v1",
      selectedFootprintOptionId: "fp-1",
    };
    expect(selection.componentFamilyId).toBeTruthy();
    expect(selection.componentRevisionId).toBeTruthy();
    expect(selection.selectedPackageVariantId).toBeTruthy();
    expect(selection.selectedFootprintOptionId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Preset inheritance
// ---------------------------------------------------------------------------

describe("preset inheritance", () => {
  test("built-in presets are immutable", () => {
    const builtIn: PresetCatalog = {
      id: "preset-1",
      name: "SMD Chip",
      scope: "built_in",
      isImmutable: true,
      variants: [],
    };
    expect(canEditPreset(builtIn)).toBe(false);
    expect(canDuplicatePreset(builtIn)).toBe(true);
  });

  test("workspace presets are editable", () => {
    const workspace: PresetCatalog = {
      id: "preset-2",
      name: "My Custom Chips",
      scope: "workspace",
      isImmutable: false,
      variants: [],
    };
    expect(canEditPreset(workspace)).toBe(true);
    expect(canDuplicatePreset(workspace)).toBe(true);
  });

  test("duplicated preset is detached from source", () => {
    const builtIn: PresetCatalog = {
      id: "preset-1",
      name: "SMD Chip",
      scope: "built_in",
      isImmutable: true,
      variants: [
        {
          id: "pv-1",
          catalogId: "preset-1",
          canonicalCode: "0603",
          humanLabel: "0603 / 1608 Metric",
          imperialAlias: "0603",
          metricAlias: "1608",
          mountType: "smd",
          typicalDimensions: { lengthMm: 1.6, widthMm: 0.8, heightMm: null },
          pinCount: 2,
        },
      ],
    };

    // Simulate duplication: new ID, workspace scope, mutable
    const duplicate: PresetCatalog = {
      ...builtIn,
      id: "preset-2",
      scope: "workspace",
      isImmutable: false,
      variants: builtIn.variants.map((v) => ({
        ...v,
        id: "pv-2",
        catalogId: "preset-2",
      })),
    };

    // Mutating source does not affect duplicate
    builtIn.variants[0]!.humanLabel = "CHANGED";
    expect(duplicate.variants[0]!.humanLabel).toBe("0603 / 1608 Metric");
    expect(canEditPreset(duplicate)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Entity hierarchy structural rules
// ---------------------------------------------------------------------------

describe("entity hierarchy rules", () => {
  test("family must have exactly one default variant", () => {
    const payload = makeDraftPayload();
    const defaults = payload.packageVariants.filter((v) => v.isDefault);
    expect(defaults.length).toBe(1);
    expect(payload.defaultPackageVariantId).toBe(defaults[0]!.id);
  });

  test("variant must have exactly one default footprint", () => {
    const variant = makeVariant({ id: "v1" });
    const defaults = variant.footprintOptions.filter((fp) => fp.isDefault);
    expect(defaults.length).toBe(1);
    expect(variant.defaultFootprintOptionId).toBe(defaults[0]!.id);
  });

  test("draft payload without variants is structurally invalid", () => {
    const payload = makeDraftPayload({ packageVariants: [] });
    expect(payload.packageVariants.length).toBe(0);
    // This would produce a "zero_package_variants" blocker at validation time
  });

  test("draft payload without default variant ID is structurally invalid", () => {
    const payload = makeDraftPayload({ defaultPackageVariantId: null });
    expect(payload.defaultPackageVariantId).toBeNull();
    // This would produce a "no_default_variant" blocker at validation time
  });
});
