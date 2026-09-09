import { describe, expect, test } from "vitest";
import type { PcbDesignRules } from "../../../../sdks";
import { DEFAULT_POUR_TO_COPPER_MM } from "../../../../shared/drc/rule-resolver";
import { designRulesForSave, seedClearance } from "./PcbDesignRulesDialog";

/**
 * The dialog's two pure pieces. The Vitest environment here is `node`, so the
 * component itself cannot be mounted; these cover what the save path actually
 * decides (rule-semantics contract §9, design-rules dialog row).
 */
function rules(overrides: Partial<PcbDesignRules> = {}): PcbDesignRules {
  return {
    clearance: {
      traceToTraceMm: 0.2,
      traceToPadMm: 0.25,
      padToPadMm: 0.25,
      traceToViaMm: 0.25,
      viaToViaMm: 0.3,
      copperToBoardEdgeMm: 0.5,
    },
    minimums: {
      traceWidthMm: 0.2,
      drillSizeMm: 0.4,
      annularRingMm: 0.2,
      viaDiameterMm: 0.8,
      viaDrillMm: 0.4,
    },
    ...overrides,
  };
}

describe("seedClearance", () => {
  test("materialises the absent pour clearance at the kernel default", () => {
    expect(seedClearance(rules()).pourToCopperMm).toBe(
      DEFAULT_POUR_TO_COPPER_MM,
    );
  });

  test("a stored value is left alone", () => {
    const stored = rules({
      clearance: { ...rules().clearance, pourToCopperMm: 0.35 },
    });
    expect(seedClearance(stored).pourToCopperMm).toBe(0.35);
  });
});

describe("designRulesForSave — the optional copper ↔ hole clearance", () => {
  test("an entered value round-trips onto the saved rules", () => {
    const stored = rules();
    const next = designRulesForSave(
      stored,
      { ...seedClearance(stored), copperToHoleMm: 0.35 },
      stored.minimums,
    );
    expect(next.clearance.copperToHoleMm).toBe(0.35);
  });

  test("a stored value survives an untouched save", () => {
    const stored = rules({
      clearance: { ...rules().clearance, copperToHoleMm: 0.35 },
    });
    expect(seedClearance(stored).copperToHoleMm).toBe(0.35);
    expect(
      designRulesForSave(stored, seedClearance(stored), stored.minimums)
        .clearance.copperToHoleMm,
    ).toBe(0.35);
  });

  test("an emptied field sends `null` — the store's explicit clear", () => {
    const stored = rules({
      clearance: { ...rules().clearance, copperToHoleMm: 0.35 },
    });
    const next = designRulesForSave(
      stored,
      { ...seedClearance(stored), copperToHoleMm: null },
      stored.minimums,
    );
    // An ABSENT key would instead keep the stored value on the update path.
    expect(next.clearance.copperToHoleMm).toBeNull();
  });

  test("a board without the key never gains one", () => {
    const stored = rules();
    expect(seedClearance(stored).copperToHoleMm).toBeUndefined();
    expect(
      "copperToHoleMm" in
        designRulesForSave(stored, seedClearance(stored), stored.minimums)
          .clearance,
    ).toBe(false);
  });
});

describe("designRulesForSave", () => {
  test("keys the dialog does not edit survive the save", () => {
    const stored = rules({
      electrical: { tempRiseC: 20, copperWeightOz: 2 },
      // Optional/additive extras must round-trip untouched too.
      clearance: { ...rules().clearance, holeToBoardEdgeMm: 0.4 },
    });
    const next = designRulesForSave(
      stored,
      { ...seedClearance(stored), pourToCopperMm: 0.4 },
      { ...stored.minimums, clearanceMm: 0.15 },
    );
    expect(next.electrical).toEqual({ tempRiseC: 20, copperWeightOz: 2 });
    expect(next.clearance.pourToCopperMm).toBe(0.4);
    expect(next.clearance.holeToBoardEdgeMm).toBe(0.4);
    expect(next.minimums.clearanceMm).toBe(0.15);
  });

  test("the edited blocks replace the stored ones wholesale", () => {
    const stored = rules();
    const next = designRulesForSave(
      stored,
      { ...stored.clearance, traceToTraceMm: 0.9 },
      stored.minimums,
    );
    expect(next.clearance.traceToTraceMm).toBe(0.9);
    expect(stored.clearance.traceToTraceMm).toBe(0.2);
  });
});
