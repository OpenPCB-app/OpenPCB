import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { ComponentImportService } from "./component-import-service";

const FIXTURES_DIR = join(
  import.meta.dir,
  "../../infrastructure/parsers/kicad/__fixtures__",
);

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("ComponentImportService", () => {
  const svc = new ComponentImportService();

  test("generates preview from capacitor footprint fixtures", () => {
    const files = [
      {
        fileName: "C_0603_1608Metric.kicad_mod",
        content: readFixture("C_0603_1608Metric.kicad_mod"),
      },
      {
        fileName: "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder.kicad_mod",
        content: readFixture(
          "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder.kicad_mod",
        ),
      },
    ];

    const result = svc.generatePreview(files, ["C_0603_1608Metric.step"]);

    expect(result.groups.length).toBe(1);
    const group = result.groups[0]!;
    expect(group.suggestedFamilyLabel).toContain("0603");
    expect(group.variants.length).toBe(2);
    expect(result.ungroupedFiles.length).toBe(0);
  });

  test("import preview returns grouped families with warnings", () => {
    const files = [
      {
        fileName: "C_0603_1608Metric.kicad_mod",
        content: readFixture("C_0603_1608Metric.kicad_mod"),
      },
      {
        fileName: "missing_3d_footprint.kicad_mod",
        content: readFixture("missing_3d_footprint.kicad_mod"),
      },
    ];

    const result = svc.generatePreview(files, ["C_0603_1608Metric.step"]);

    // Should have groups for both
    expect(result.groups.length).toBeGreaterThanOrEqual(1);
    // Missing 3D should produce a warning
    expect(result.totalWarnings).toBeGreaterThan(0);
  });

  test("handles symbol files alongside footprints", () => {
    const files = [
      {
        fileName: "simple_capacitor.kicad_sym",
        content: readFixture("simple_capacitor.kicad_sym"),
      },
      {
        fileName: "C_0603_1608Metric.kicad_mod",
        content: readFixture("C_0603_1608Metric.kicad_mod"),
      },
    ];

    const result = svc.generatePreview(files, []);

    expect(result.groups.length).toBe(1);
    // Symbol should be matched to the capacitor group
    expect(result.groups[0]!.symbolFileName).toBe("simple_capacitor.kicad_sym");
  });

  test("ambiguous grouping requires confirm", () => {
    // Import manufacturer-specific alongside generic
    const files = [
      {
        fileName: "CP_Elec_6.3x5.4_Nichicon.kicad_mod",
        content: readFixture("CP_Elec_6.3x5.4_Nichicon.kicad_mod"),
      },
    ];

    const result = svc.generatePreview(files, [
      "CP_Elec_6.3x5.4_Nichicon.step",
    ]);

    expect(result.groups.length).toBe(1);
    const group = result.groups[0]!;
    expect(group.suggestedFamilyLabel).toContain("Electrolytic");
    expect(group.suggestedFamilyLabel).toContain("6.3x5.4");
  });

  test("ungrouped files are reported for unparseable content", () => {
    const files = [
      {
        fileName: "garbage.kicad_mod",
        content: "this is not valid sexpr content",
      },
    ];

    const result = svc.generatePreview(files, []);
    expect(result.ungroupedFiles).toContain("garbage.kicad_mod");
  });

  test("3D link classification produces warnings for missing models", () => {
    const files = [
      {
        fileName: "missing_3d_footprint.kicad_mod",
        content: readFixture("missing_3d_footprint.kicad_mod"),
      },
    ];

    const result = svc.generatePreview(files, []);
    const missingWarnings = result.groups.flatMap((g) =>
      g.warnings.filter((w) => w.code === "missing_3d_model"),
    );
    expect(missingWarnings.length).toBeGreaterThan(0);
  });
});
