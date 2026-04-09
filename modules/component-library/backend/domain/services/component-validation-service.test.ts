import { describe, expect, it } from "bun:test";
import { ComponentValidationService } from "./component-validation-service";
import type {
  ComponentDraftPayload,
  FootprintOption,
  PackageVariant,
  PinDefinition,
  SymbolData,
} from "../../core/schemas/component-semantics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pin(name: string): PinDefinition {
  return { name, electricalType: "passive" };
}

function footprint(overrides: Partial<FootprintOption> = {}): FootprintOption {
  return {
    id: overrides.id ?? "fp-1",
    variantId: overrides.variantId ?? "v-1",
    label: overrides.label ?? "Nominal",
    isDefault: overrides.isDefault ?? true,
    kicadPayload: null,
    model3dOptions: overrides.model3dOptions ?? [
      {
        id: "m-1",
        footprintOptionId: "fp-1",
        fileName: "model.step",
        stepAssetPath: null,
        gltfPreviewPath: null,
        isDefault: true,
        linkStatus: "valid",
      },
    ],
    defaultModel3dOptionId: overrides.defaultModel3dOptionId ?? "m-1",
  };
}

function variant(overrides: Partial<PackageVariant> = {}): PackageVariant {
  return {
    id: overrides.id ?? "v-1",
    familyId: overrides.familyId ?? "fam-1",
    canonicalCode: overrides.canonicalCode ?? "0603",
    humanLabel: overrides.humanLabel ?? "0603",
    imperialAlias: null,
    metricAlias: null,
    mountType: overrides.mountType ?? "smd",
    dimensions: null,
    isDefault: overrides.isDefault ?? true,
    pinRemapTable: overrides.pinRemapTable ?? null,
    footprintOptions: overrides.footprintOptions ?? [footprint()],
    defaultFootprintOptionId: overrides.defaultFootprintOptionId ?? "fp-1",
    offerings: overrides.offerings ?? [
      {
        id: "off-1",
        variantId: "v-1",
        mpn: "GRM155R71C104KA88D",
        manufacturer: "Murata",
        datasheetUrl: null,
      },
    ],
  };
}

function symbolData(pins: PinDefinition[] = [pin("1"), pin("2")]): SymbolData {
  return {
    referencePrefix: "C",
    pinDefinitions: pins,
    properties: {},
    unitCount: 1,
    bodyGraphics: [],
    rawKicadSource: null,
  };
}

function validPayload(
  overrides: Partial<ComponentDraftPayload> = {},
): ComponentDraftPayload {
  return {
    displayLabel: "Ceramic Capacitor",
    description: "MLCC",
    symbolData: overrides.symbolData ?? symbolData(),
    packageVariants: overrides.packageVariants ?? [variant()],
    defaultPackageVariantId: overrides.defaultPackageVariantId ?? "v-1",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const svc = new ComponentValidationService();

describe("ComponentValidationService", () => {
  describe("validateForPublish", () => {
    it("passes valid payload", () => {
      const result = svc.validateForPublish(validPayload());
      expect(result.canPublish).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("blocks on missing symbol data (no pins)", () => {
      const result = svc.validateForPublish(
        validPayload({
          symbolData: symbolData([]),
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(
        result.blockers.some((b) => b.code === "missing_symbol_data"),
      ).toBe(true);
    });

    it("blocks on zero package variants", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [],
          defaultPackageVariantId: null,
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(
        result.blockers.some((b) => b.code === "zero_package_variants"),
      ).toBe(true);
    });

    it("blocks when no default variant", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [variant({ isDefault: false })],
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(result.blockers.some((b) => b.code === "no_default_variant")).toBe(
        true,
      );
    });

    it("blocks when multiple default variants", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [
            variant({ id: "v-1", isDefault: true, canonicalCode: "0603" }),
            variant({ id: "v-2", isDefault: true, canonicalCode: "0805" }),
          ],
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(result.blockers.some((b) => b.code === "no_default_variant")).toBe(
        true,
      );
    });

    it("rejects publish without default package variant", () => {
      const v = variant({ isDefault: false });
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [v],
        }),
      );
      expect(result.canPublish).toBe(false);
      const issue = result.blockers.find(
        (b) => b.code === "no_default_variant",
      );
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("0");
    });

    it("blocks on variant missing default footprint", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [
            variant({
              footprintOptions: [footprint({ isDefault: false })],
            }),
          ],
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(
        result.blockers.some(
          (b) => b.code === "variant_missing_default_footprint",
        ),
      ).toBe(true);
    });

    it("blocks on unresolved pin remap key", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [
            variant({
              pinRemapTable: { NONEXISTENT: "pad1" },
            }),
          ],
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(
        result.blockers.some((b) => b.code === "unresolved_pin_remap"),
      ).toBe(true);
    });

    it("blocks on broken defaultPackageVariantId", () => {
      const result = svc.validateForPublish(
        validPayload({
          defaultPackageVariantId: "nonexistent-id",
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(
        result.blockers.some((b) => b.code === "broken_internal_ids"),
      ).toBe(true);
    });

    it("blocks on duplicate canonical codes", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [
            variant({ id: "v-1", canonicalCode: "0603", isDefault: true }),
            variant({ id: "v-2", canonicalCode: "0603", isDefault: false }),
          ],
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(
        result.blockers.some((b) => b.code === "duplicate_canonical_code"),
      ).toBe(true);
    });

    it("warns on missing 3D model but still publishes", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [
            variant({
              footprintOptions: [footprint({ model3dOptions: [] })],
            }),
          ],
        }),
      );
      expect(result.canPublish).toBe(true);
      expect(result.warnings.some((w) => w.code === "missing_3d_model")).toBe(
        true,
      );
    });

    it("warns on absent offerings but still publishes", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [variant({ offerings: [] })],
        }),
      );
      expect(result.canPublish).toBe(true);
      expect(result.warnings.some((w) => w.code === "absent_offerings")).toBe(
        true,
      );
    });

    it("blocks on broken defaultFootprintOptionId in variant", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [
            variant({
              defaultFootprintOptionId: "nonexistent-fp",
            }),
          ],
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(
        result.blockers.some((b) => b.code === "broken_internal_ids"),
      ).toBe(true);
    });

    it("accepts valid pin remap keys", () => {
      const result = svc.validateForPublish(
        validPayload({
          packageVariants: [
            variant({
              pinRemapTable: { "1": "pad_a", "2": "pad_b" },
            }),
          ],
        }),
      );
      expect(result.canPublish).toBe(true);
      expect(
        result.blockers.filter((b) => b.code === "unresolved_pin_remap"),
      ).toHaveLength(0);
    });
  });
});
