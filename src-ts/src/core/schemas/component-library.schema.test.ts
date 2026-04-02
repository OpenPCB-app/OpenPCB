import { describe, expect, test } from "bun:test";
import {
  ComponentReferenceSchema,
  ComponentSchema,
  ComponentVariantSchema,
} from "./component-library.schema";

const UUID = "01935c4a-1b2d-7e3f-8c9d-0e1f2a3b4c5d";
const UUID2 = "01935c4a-1b2d-7e3f-8c9d-0e1f2a3b4c5e";

describe("ComponentSchema", () => {
  test("accepts workspace component payload", () => {
    const parsed = ComponentSchema.parse({
      id: UUID,
      canonicalKey: "resistor_chip",
      displayLabel: "Resistor",
      description: "",
      scope: "workspace",
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
      variants: [],
      defaultVariantId: null,
      categoryPath: null,
      tags: [],
    });

    expect(parsed.scope).toBe("workspace");
    expect(parsed.id).toBe(UUID);
  });

  test("rejects non-workspace scope", () => {
    const result = ComponentSchema.safeParse({
      id: UUID,
      canonicalKey: "resistor_chip",
      displayLabel: "Resistor",
      description: "",
      scope: "built_in",
      symbolData: {
        referencePrefix: "R",
        pinDefinitions: [],
        properties: {},
        unitCount: 1,
      },
      variants: [],
      defaultVariantId: null,
      categoryPath: null,
      tags: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ComponentVariantSchema", () => {
  test("accepts variant with direct footprint payload", () => {
    const parsed = ComponentVariantSchema.parse({
      id: UUID,
      componentId: UUID2,
      canonicalCode: "0603",
      humanLabel: "0603",
      imperialAlias: "0603",
      metricAlias: "1608",
      mountType: "smd",
      dimensions: { lengthMm: 1.6, widthMm: 0.8, heightMm: null },
      isDefault: true,
      pinRemapTable: null,
      footprintOptions: [
        {
          id: UUID,
          variantId: UUID,
          label: "Nominal",
          isDefault: true,
          kicadPayload: { pads: [] },
          densityLevel: "nominal",
          ipcName: null,
        },
      ],
      defaultFootprintOptionId: UUID,
    });

    expect(parsed.footprintOptions[0]?.label).toBe("Nominal");
    expect(parsed.componentId).toBe(UUID2);
  });
});

describe("ComponentReferenceSchema", () => {
  test("accepts design-side live link reference", () => {
    const parsed = ComponentReferenceSchema.parse({
      component_id: UUID,
      variant_id: UUID2,
      footprint_id: null,
      reference: "R1",
    });

    expect(parsed.component_id).toBe(UUID);
    expect(parsed.variant_id).toBe(UUID2);
  });
});
