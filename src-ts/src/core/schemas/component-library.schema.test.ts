import { describe, expect, test } from "bun:test";
import {
  ComponentDraftSchema,
  ComponentFamilySchema,
  CreateComponentDraftInputSchema,
  ImportConfirmInputSchema,
  ImportPreviewSchema,
  PackageVariantSchema,
  PresetCatalogSchema,
  SchematicComponentSelectionSchema,
  SwitchPreviewSchema,
  UpdateComponentDraftInputSchema,
  ValidationResultSchema,
} from "./component-library.schema";

const UUID = "01935c4a-1b2d-7e3f-8c9d-0e1f2a3b4c5d";
const UUID2 = "01935c4a-1b2d-7e3f-8c9d-0e1f2a3b4c5e";
const NOW = "2026-03-31T12:00:00.000Z";

// ---------------------------------------------------------------------------
// ComponentFamily
// ---------------------------------------------------------------------------

describe("ComponentFamilySchema", () => {
  const validFamily = {
    id: UUID,
    canonicalKey: "ceramic_capacitor",
    displayLabel: "Ceramic Capacitor",
    description: "Generic MLCC",
    scope: "built_in",
    symbolData: {
      referencePrefix: "C",
      pinDefinitions: [
        { name: "1", electricalType: "passive" },
        { name: "2", electricalType: "passive" },
      ],
      properties: {},
      unitCount: 1,
      bodyGraphics: [],
      rawKicadSource: null,
    },
    packageVariants: [],
    defaultPackageVariantId: null,
    categoryPath: null,
    tags: [],
  };

  test("accepts valid family", () => {
    const parsed = ComponentFamilySchema.parse(validFamily);
    expect(parsed.canonicalKey).toBe("ceramic_capacitor");
    expect(parsed.scope).toBe("built_in");
  });

  test("rejects empty canonicalKey", () => {
    const result = ComponentFamilySchema.safeParse({
      ...validFamily,
      canonicalKey: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid scope", () => {
    const result = ComponentFamilySchema.safeParse({
      ...validFamily,
      scope: "community",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PackageVariant
// ---------------------------------------------------------------------------

describe("PackageVariantSchema", () => {
  const validVariant = {
    id: UUID,
    familyId: UUID2,
    canonicalCode: "0603",
    humanLabel: "0603 / 1608 Metric",
    imperialAlias: "0603",
    metricAlias: "1608",
    mountType: "smd",
    dimensions: { lengthMm: 1.6, widthMm: 0.8, heightMm: null },
    isDefault: true,
    pinRemapTable: null,
    footprintOptions: [],
    defaultFootprintOptionId: null,
    offerings: [],
  };

  test("accepts valid variant with dimensions", () => {
    const parsed = PackageVariantSchema.parse(validVariant);
    expect(parsed.dimensions?.lengthMm).toBe(1.6);
  });

  test("accepts variant without dimensions", () => {
    const parsed = PackageVariantSchema.parse({
      ...validVariant,
      dimensions: null,
    });
    expect(parsed.dimensions).toBeNull();
  });

  test("rejects invalid mount type", () => {
    const result = PackageVariantSchema.safeParse({
      ...validVariant,
      mountType: "flying_wire",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SchematicComponentSelection
// ---------------------------------------------------------------------------

describe("SchematicComponentSelectionSchema", () => {
  test("accepts complete selection", () => {
    const parsed = SchematicComponentSelectionSchema.parse({
      componentFamilyId: UUID,
      componentRevisionId: UUID,
      selectedPackageVariantId: UUID,
      selectedFootprintOptionId: UUID,
    });
    expect(parsed.componentFamilyId).toBe(UUID);
  });

  test("rejects schematic selection without package variant", () => {
    const result = SchematicComponentSelectionSchema.safeParse({
      componentFamilyId: UUID,
      componentRevisionId: UUID,
      selectedFootprintOptionId: UUID,
    });
    expect(result.success).toBe(false);
  });

  test("rejects schematic selection without footprint option", () => {
    const result = SchematicComponentSelectionSchema.safeParse({
      componentFamilyId: UUID,
      componentRevisionId: UUID,
      selectedPackageVariantId: UUID,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ComponentDraft
// ---------------------------------------------------------------------------

describe("ComponentDraftSchema", () => {
  const validDraft = {
    id: UUID,
    familyId: null,
    wizardStep: 0,
    payload: {
      displayLabel: "Resistor",
      description: "",
      symbolData: {
        referencePrefix: "R",
        pinDefinitions: [
          { name: "1", electricalType: "passive" },
          { name: "2", electricalType: "passive" },
        ],
        properties: {},
        unitCount: 1,
        bodyGraphics: [],
        rawKicadSource: null,
      },
      packageVariants: [],
      defaultPackageVariantId: null,
    },
    warnings: [],
    createdAt: NOW,
    updatedAt: NOW,
  };

  test("accepts valid draft", () => {
    const parsed = ComponentDraftSchema.parse(validDraft);
    expect(parsed.wizardStep).toBe(0);
    expect(parsed.familyId).toBeNull();
  });

  test("accepts draft with warnings", () => {
    const parsed = ComponentDraftSchema.parse({
      ...validDraft,
      warnings: [
        {
          code: "missing_3d_model",
          message: "No 3D model found",
          severity: "warning",
          context: { footprintId: "fp-1" },
        },
      ],
    });
    expect(parsed.warnings.length).toBe(1);
    expect(parsed.warnings[0]!.severity).toBe("warning");
  });

  test("rejects negative wizard step", () => {
    const result = ComponentDraftSchema.safeParse({
      ...validDraft,
      wizardStep: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Preset catalog
// ---------------------------------------------------------------------------

describe("PresetCatalogSchema", () => {
  test("accepts valid catalog with variants", () => {
    const parsed = PresetCatalogSchema.parse({
      id: UUID,
      name: "SMD Chip Capacitors",
      scope: "built_in",
      isImmutable: true,
      variants: [
        {
          id: UUID2,
          catalogId: UUID,
          canonicalCode: "0603",
          humanLabel: "0603 / 1608 Metric",
          imperialAlias: "0603",
          metricAlias: "1608",
          mountType: "smd",
          typicalDimensions: {
            lengthMm: 1.6,
            widthMm: 0.8,
            heightMm: null,
          },
          pinCount: 2,
        },
      ],
    });
    expect(parsed.isImmutable).toBe(true);
    expect(parsed.variants.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

describe("ValidationResultSchema", () => {
  test("accepts result with blockers preventing publish", () => {
    const parsed = ValidationResultSchema.parse({
      blockers: [
        {
          code: "zero_package_variants",
          message: "Family has no package variants",
          entityId: UUID,
          entityType: "family",
        },
      ],
      warnings: [],
      canPublish: false,
    });
    expect(parsed.canPublish).toBe(false);
    expect(parsed.blockers.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Switch preview
// ---------------------------------------------------------------------------

describe("SwitchPreviewSchema", () => {
  test("accepts auto_apply outcome", () => {
    const parsed = SwitchPreviewSchema.parse({
      outcome: "auto_apply",
      sourceVariantId: UUID,
      targetVariantId: UUID2,
      newFootprintOptionId: null,
      affectedPins: [],
      confirmationMessage: null,
    });
    expect(parsed.outcome).toBe("auto_apply");
  });

  test("accepts requires_confirmation with message", () => {
    const parsed = SwitchPreviewSchema.parse({
      outcome: "requires_confirmation",
      sourceVariantId: UUID,
      targetVariantId: UUID2,
      newFootprintOptionId: UUID,
      affectedPins: ["1", "2", "3"],
      confirmationMessage: "Pin count changes from 2 to 3",
    });
    expect(parsed.affectedPins.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Import preview
// ---------------------------------------------------------------------------

describe("ImportPreviewSchema", () => {
  test("accepts grouped preview", () => {
    const parsed = ImportPreviewSchema.parse({
      groups: [
        {
          suggestedFamilyLabel: "Chip Capacitor 0603",
          suggestedCanonicalKey: "chip_capacitor_0603",
          variants: [
            {
              suggestedCanonicalCode: "0603",
              suggestedHumanLabel: "0603 / 1608 Metric",
              footprintFileNames: [
                "C_0603_1608Metric.kicad_mod",
                "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder.kicad_mod",
              ],
              model3dFileNames: ["C_0603_1608Metric.step"],
              confidence: 0.95,
            },
          ],
          warnings: [],
          symbolFileName: null,
        },
      ],
      ungroupedFiles: [],
      totalWarnings: 0,
      totalBlockers: 0,
    });
    expect(parsed.groups.length).toBe(1);
    expect(parsed.groups[0]!.variants[0]!.confidence).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// API inputs
// ---------------------------------------------------------------------------

describe("CreateComponentDraftInputSchema", () => {
  test("accepts minimal input", () => {
    const parsed = CreateComponentDraftInputSchema.parse({
      displayLabel: "New Capacitor",
    });
    expect(parsed.description).toBe("");
    expect(parsed.importFromFiles).toBe(false);
  });

  test("rejects empty label", () => {
    const result = CreateComponentDraftInputSchema.safeParse({
      displayLabel: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateComponentDraftInputSchema", () => {
  test("accepts partial update", () => {
    const parsed = UpdateComponentDraftInputSchema.parse({
      wizardStep: 2,
    });
    expect(parsed.wizardStep).toBe(2);
    expect(parsed.payload).toBeUndefined();
  });
});

describe("ImportConfirmInputSchema", () => {
  test("accepts confirm with publish flag", () => {
    const parsed = ImportConfirmInputSchema.parse({
      groups: [
        {
          familyLabel: "Ceramic Capacitor",
          canonicalKey: "ceramic_cap",
          variants: [
            {
              canonicalCode: "0603",
              humanLabel: "0603",
              footprintFileNames: ["C_0603.kicad_mod"],
              model3dFileNames: [],
            },
          ],
          symbolFileName: null,
        },
      ],
      publishImmediately: true,
    });
    expect(parsed.publishImmediately).toBe(true);
  });
});
