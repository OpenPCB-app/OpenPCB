import { describe, expect, test } from "bun:test";
import { classifyModel3DLinks } from "./kicad-model-linker";

describe("kicad-model-linker", () => {
  test("valid link: footprint refs model, model exists", () => {
    const results = classifyModel3DLinks(
      [{ name: "C_0603", model3dRefs: [{ resolvedFileName: "C_0603.step" }] }],
      ["C_0603.step"],
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      footprintName: "C_0603",
      modelFileName: "C_0603.step",
      status: "valid",
    });
  });

  test("missing target: footprint refs model, model not in available files", () => {
    const results = classifyModel3DLinks(
      [
        {
          name: "C_Missing3D",
          model3dRefs: [{ resolvedFileName: "DOES_NOT_EXIST.step" }],
        },
      ],
      ["C_0603.step"],
    );
    const missing = results.filter((r) => r.status === "missing_target");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.footprintName).toBe("C_Missing3D");
    expect(missing[0]!.modelFileName).toBe("DOES_NOT_EXIST.step");
  });

  test("shared body: two footprints reference same model (nominal + hand-solder)", () => {
    const results = classifyModel3DLinks(
      [
        {
          name: "C_0603_1608Metric",
          model3dRefs: [{ resolvedFileName: "C_0603_1608Metric.step" }],
        },
        {
          name: "C_0603_1608Metric_Pad1.08x0.95mm_HandSolder",
          model3dRefs: [{ resolvedFileName: "C_0603_1608Metric.step" }],
        },
      ],
      ["C_0603_1608Metric.step"],
    );
    const shared = results.filter((r) => r.status === "shared_body");
    expect(shared).toHaveLength(2);
    expect(shared[0]!.modelFileName).toBe("C_0603_1608Metric.step");
    expect(shared[1]!.modelFileName).toBe("C_0603_1608Metric.step");
  });

  test("orphan asset: model exists but no footprint references it", () => {
    const results = classifyModel3DLinks(
      [{ name: "C_0603", model3dRefs: [{ resolvedFileName: "C_0603.step" }] }],
      ["C_0603.step", "Orphan_Model.step"],
    );
    const orphans = results.filter((r) => r.status === "orphan_asset");
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.modelFileName).toBe("Orphan_Model.step");
    expect(orphans[0]!.footprintName).toBe("");
  });

  test("missing step file warns", () => {
    const results = classifyModel3DLinks(
      [
        {
          name: "FP_NoModel",
          model3dRefs: [{ resolvedFileName: "nonexistent.step" }],
        },
      ],
      [],
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("missing_target");
    expect(results[0]!.modelFileName).toBe("nonexistent.step");
  });

  test("classifies missing and orphan 3d links", () => {
    const results = classifyModel3DLinks(
      [
        {
          name: "FP_Good",
          model3dRefs: [{ resolvedFileName: "good.step" }],
        },
        {
          name: "FP_Bad",
          model3dRefs: [{ resolvedFileName: "missing.step" }],
        },
      ],
      ["good.step", "unused.step"],
    );

    const valid = results.filter((r) => r.status === "valid");
    const missing = results.filter((r) => r.status === "missing_target");
    const orphan = results.filter((r) => r.status === "orphan_asset");

    expect(valid).toHaveLength(1);
    expect(valid[0]!.footprintName).toBe("FP_Good");

    expect(missing).toHaveLength(1);
    expect(missing[0]!.footprintName).toBe("FP_Bad");

    expect(orphan).toHaveLength(1);
    expect(orphan[0]!.modelFileName).toBe("unused.step");
  });

  test("empty inputs produce empty results", () => {
    expect(classifyModel3DLinks([], [])).toEqual([]);
  });

  test("footprint with no model refs produces no entries for it", () => {
    const results = classifyModel3DLinks(
      [{ name: "FP_NoRefs", model3dRefs: [] }],
      ["some.step"],
    );
    // Only orphan for the unreferenced model
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("orphan_asset");
  });
});
