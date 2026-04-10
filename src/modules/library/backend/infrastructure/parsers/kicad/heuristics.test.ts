import { describe, expect, test } from "bun:test";
import {
  extractGroupKey,
  extractPackageCode,
  groupFootprints,
  isHandSolderVariant,
  isManufacturerSpecific,
  isPolarized,
  type FootprintFileInfo,
} from "./heuristics";

describe("import heuristics", () => {
  describe("extractGroupKey", () => {
    test("strips HandSolder suffix", () => {
      expect(
        extractGroupKey("C_0603_1608Metric_Pad1.08x0.95mm_HandSolder"),
      ).toBe("C_0603");
    });

    test("groups chip capacitor by package code", () => {
      expect(extractGroupKey("C_0603_1608Metric")).toBe("C_0603");
    });

    test("groups manufacturer-specific electrolytic by size", () => {
      expect(extractGroupKey("CP_Elec_6.3x5.4_Nichicon")).toBe(
        "CP_Elec_6.3x5.4",
      );
    });

    test("keeps trimmer as separate key", () => {
      expect(extractGroupKey("C_Trimmer_Murata_TZY2")).toBe(
        "C_Trimmer_Murata_TZY2",
      );
    });
  });

  describe("extractPackageCode", () => {
    test("extracts imperial and metric from chip name", () => {
      const result = extractPackageCode("C_0603_1608Metric");
      expect(result.code).toBe("0603");
      expect(result.imperial).toBe("0603");
      expect(result.metric).toBe("1608");
    });

    test("infers metric from imperial when missing", () => {
      const result = extractPackageCode("C_0805");
      expect(result.imperial).toBe("0805");
      expect(result.metric).toBe("2012");
    });

    test("extracts electrolytic size", () => {
      const result = extractPackageCode("CP_Elec_6.3x5.4_Nichicon");
      expect(result.code).toBe("6.3x5.4");
    });
  });

  describe("isHandSolderVariant", () => {
    test("detects hand-solder suffix", () => {
      expect(
        isHandSolderVariant("C_0603_1608Metric_Pad1.08x0.95mm_HandSolder"),
      ).toBe(true);
    });

    test("rejects nominal footprint", () => {
      expect(isHandSolderVariant("C_0603_1608Metric")).toBe(false);
    });
  });

  describe("isManufacturerSpecific", () => {
    test("detects Nichicon electrolytic", () => {
      const result = isManufacturerSpecific("CP_Elec_6.3x5.4_Nichicon");
      expect(result.isSpecific).toBe(true);
      expect(result.manufacturer).toBe("Nichicon");
    });

    test("rejects generic chip capacitor", () => {
      const result = isManufacturerSpecific("C_0603_1608Metric");
      expect(result.isSpecific).toBe(false);
    });
  });

  describe("isPolarized", () => {
    test("detects CP_ prefix", () => {
      expect(isPolarized("CP_Elec_6.3x5.4")).toBe(true);
    });

    test("rejects C_ prefix", () => {
      expect(isPolarized("C_0603_1608Metric")).toBe(false);
    });
  });

  describe("groupFootprints", () => {
    test("groups nominal and hand-solder under same family", () => {
      const fps: FootprintFileInfo[] = [
        {
          fileName: "C_0603_1608Metric.kicad_mod",
          name: "C_0603_1608Metric",
          model3dFileNames: ["C_0603_1608Metric.step"],
        },
        {
          fileName: "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder.kicad_mod",
          name: "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder",
          model3dFileNames: ["C_0603_1608Metric.step"],
        },
      ];

      const groups = groupFootprints(fps);
      expect(groups.length).toBe(1);
      expect(groups[0]!.variants.length).toBe(2);
    });

    test("separates polarized from non-polarized", () => {
      const fps: FootprintFileInfo[] = [
        {
          fileName: "C_0603.kicad_mod",
          name: "C_0603_1608Metric",
          model3dFileNames: [],
        },
        {
          fileName: "CP_Elec_6.3x5.4_Nichicon.kicad_mod",
          name: "CP_Elec_6.3x5.4_Nichicon",
          model3dFileNames: [],
        },
      ];

      const groups = groupFootprints(fps);
      expect(groups.length).toBe(2);
    });

    test("groups manufacturer variants under same electrolytic size", () => {
      const fps: FootprintFileInfo[] = [
        {
          fileName: "CP_Elec_6.3x5.4.kicad_mod",
          name: "CP_Elec_6.3x5.4",
          model3dFileNames: [],
        },
        {
          fileName: "CP_Elec_6.3x5.4_Nichicon.kicad_mod",
          name: "CP_Elec_6.3x5.4_Nichicon",
          model3dFileNames: [],
        },
      ];

      const groups = groupFootprints(fps);
      expect(groups.length).toBe(1);
    });

    test("classifies missing and orphan 3d links", () => {
      // This tests that grouping preserves model file info for later classification
      const fps: FootprintFileInfo[] = [
        {
          fileName: "C_0603.kicad_mod",
          name: "C_0603_1608Metric",
          model3dFileNames: ["DOES_NOT_EXIST.step"],
        },
      ];

      const groups = groupFootprints(fps);
      expect(groups.length).toBe(1);
      expect(groups[0]!.variants[0]!.model3dFileNames).toContain(
        "DOES_NOT_EXIST.step",
      );
    });
  });
});
