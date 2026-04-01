import { describe, expect, it } from "bun:test";
import { PackageSwitchService } from "./package-switch-service";
import type {
  FootprintOption,
  PackageVariant,
  PinDefinition,
  SchematicComponentSelection,
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
    model3dOptions: [],
    defaultModel3dOptionId: null,
  };
}

function variant(overrides: Partial<PackageVariant> = {}): PackageVariant {
  return {
    id: overrides.id ?? "v-1",
    familyId: "fam-1",
    canonicalCode: overrides.canonicalCode ?? "0603",
    humanLabel: overrides.humanLabel ?? "0603",
    imperialAlias: null,
    metricAlias: null,
    mountType: "smd",
    dimensions: null,
    isDefault: overrides.isDefault ?? true,
    pinRemapTable: overrides.pinRemapTable ?? null,
    footprintOptions: overrides.footprintOptions ?? [footprint()],
    defaultFootprintOptionId:
      "defaultFootprintOptionId" in overrides
        ? overrides.defaultFootprintOptionId!
        : "fp-1",
    offerings: [],
  };
}

function selection(
  overrides: Partial<SchematicComponentSelection> = {},
): SchematicComponentSelection {
  return {
    componentFamilyId: "fam-1",
    componentRevisionId: "rev-1",
    selectedPackageVariantId: overrides.selectedPackageVariantId ?? "v-1",
    selectedFootprintOptionId: overrides.selectedFootprintOptionId ?? "fp-1",
  };
}

const familyPins = [pin("1"), pin("2")];
const svc = new PackageSwitchService();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PackageSwitchService", () => {
  describe("previewSwitch", () => {
    it("identity switch → auto_apply", () => {
      const v = variant();
      const result = svc.previewSwitch(
        { variants: [v], pinDefinitions: familyPins },
        selection(),
        "v-1",
      );
      expect(result.outcome).toBe("auto_apply");
      expect(result.newFootprintOptionId).toBe("fp-1");
      expect(result.affectedPins).toHaveLength(0);
      expect(result.confirmationMessage).toBeNull();
    });

    it("pin-compatible different variant → auto_apply", () => {
      const src = variant({
        id: "v-1",
        footprintOptions: [footprint({ id: "fp-shared" })],
        defaultFootprintOptionId: "fp-shared",
      });
      const tgt = variant({
        id: "v-2",
        canonicalCode: "0805",
        footprintOptions: [footprint({ id: "fp-shared", variantId: "v-2" })],
        defaultFootprintOptionId: "fp-shared",
      });
      const result = svc.previewSwitch(
        { variants: [src, tgt], pinDefinitions: familyPins },
        selection({ selectedFootprintOptionId: "fp-shared" }),
        "v-2",
      );
      expect(result.outcome).toBe("auto_apply");
      expect(result.newFootprintOptionId).toBe("fp-shared");
    });

    it("footprint not in target → auto_fallback", () => {
      const src = variant({ id: "v-1" });
      const tgt = variant({
        id: "v-2",
        canonicalCode: "0805",
        footprintOptions: [footprint({ id: "fp-2", variantId: "v-2" })],
        defaultFootprintOptionId: "fp-2",
      });
      const result = svc.previewSwitch(
        { variants: [src, tgt], pinDefinitions: familyPins },
        selection({ selectedFootprintOptionId: "fp-1" }),
        "v-2",
      );
      expect(result.outcome).toBe("auto_fallback");
      expect(result.newFootprintOptionId).toBe("fp-2");
    });

    it("pin count mismatch → requires_confirmation with message", () => {
      // Source has 2 remapped pins, target has 3 → count differs
      const src = variant({
        id: "v-1",
        pinRemapTable: { "1": "A", "2": "B" },
      });
      const tgt = variant({
        id: "v-2",
        canonicalCode: "SOT-23",
        pinRemapTable: { "1": "A", "2": "B", "3": "C" },
        footprintOptions: [footprint({ id: "fp-2", variantId: "v-2" })],
        defaultFootprintOptionId: "fp-2",
      });
      const result = svc.previewSwitch(
        {
          variants: [src, tgt],
          pinDefinitions: [pin("1"), pin("2"), pin("3")],
        },
        selection(),
        "v-2",
      );
      expect(result.outcome).toBe("requires_confirmation");
      expect(result.confirmationMessage).toContain("Pin count changes");
      expect(result.affectedPins.length).toBeGreaterThan(0);
    });

    it("pin name mismatch → requires_confirmation", () => {
      const src = variant({ id: "v-1", pinRemapTable: { "1": "A", "2": "B" } });
      const tgt = variant({
        id: "v-2",
        canonicalCode: "0805",
        pinRemapTable: { "1": "A", "2": "C" },
        footprintOptions: [footprint({ id: "fp-2", variantId: "v-2" })],
        defaultFootprintOptionId: "fp-2",
      });
      const result = svc.previewSwitch(
        { variants: [src, tgt], pinDefinitions: familyPins },
        selection(),
        "v-2",
      );
      expect(result.outcome).toBe("requires_confirmation");
      expect(result.confirmationMessage).toContain("Pin mapping changes");
      expect(result.affectedPins).toContain("B");
    });

    it("requires confirmation for remapped pins", () => {
      const src = variant({
        id: "v-1",
        pinRemapTable: { "1": "padA", "2": "padB" },
      });
      const tgt = variant({
        id: "v-2",
        canonicalCode: "QFN",
        pinRemapTable: { "1": "padC", "2": "padD" },
        footprintOptions: [footprint({ id: "fp-2", variantId: "v-2" })],
        defaultFootprintOptionId: "fp-2",
      });
      const result = svc.previewSwitch(
        { variants: [src, tgt], pinDefinitions: familyPins },
        selection(),
        "v-2",
      );
      expect(result.outcome).toBe("requires_confirmation");
      expect(result.affectedPins.length).toBeGreaterThan(0);
    });

    it("source variant not found → blocked", () => {
      const tgt = variant({ id: "v-2", canonicalCode: "0805" });
      const result = svc.previewSwitch(
        { variants: [tgt], pinDefinitions: familyPins },
        selection({ selectedPackageVariantId: "missing" }),
        "v-2",
      );
      expect(result.outcome).toBe("blocked");
      expect(result.confirmationMessage).toBe("Source variant not found");
    });

    it("target variant not found → blocked", () => {
      const src = variant({ id: "v-1" });
      const result = svc.previewSwitch(
        { variants: [src], pinDefinitions: familyPins },
        selection(),
        "missing",
      );
      expect(result.outcome).toBe("blocked");
      expect(result.confirmationMessage).toBe("Target variant not found");
    });

    it("blocks pcb sync when footprint unresolved", () => {
      const src = variant({ id: "v-1" });
      const tgt = variant({
        id: "v-2",
        canonicalCode: "0805",
        footprintOptions: [],
        defaultFootprintOptionId: null,
      });
      const result = svc.previewSwitch(
        { variants: [src, tgt], pinDefinitions: familyPins },
        selection(),
        "v-2",
      );
      expect(result.outcome).toBe("blocked");
      expect(result.confirmationMessage).toBe(
        "Target variant has no default footprint",
      );
      expect(result.newFootprintOptionId).toBeNull();
    });
  });
});
