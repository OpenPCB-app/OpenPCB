import { describe, expect, test } from "bun:test";
import {
  bomExportFileName,
  exportBundleName,
} from "../../../sdks/designer";
import { bootDesignerRuntime } from "./helpers/designer-runtime";

const ID = "cc5a12b9-bd16-4e8c-9c00-f94598075fd5";

describe("export names follow the design name (T-164)", () => {
  test("the bundle name is a filesystem-safe slug of the design name", () => {
    expect(exportBundleName(ID, "Dual LED Blinker (v2)")).toBe(
      "Dual_LED_Blinker_v2",
    );
    expect(exportBundleName(ID, "Návrh dosky / rev.B")).toBe(
      "Navrh_dosky_rev_B",
    );
    expect(exportBundleName(ID, "a".repeat(39) + " b")).toBe("a".repeat(39));
    // Nothing usable in the name → the whole id, never a mid-group cut.
    for (const empty of [undefined, null, "", "   ", "!!!", "日本"]) {
      expect(exportBundleName(ID, empty)).toBe(`openpcb-${ID}`);
    }
  });

  test("standalone BOM / CPL downloads share the bundle prefix", () => {
    expect(bomExportFileName("Blinker", "csv")).toBe("Blinker-BOM.csv");
    expect(bomExportFileName("Blinker", "tsv")).toBe("Blinker-BOM.tsv");
    expect(bomExportFileName("Blinker", "jlc")).toBe("Blinker-JLC-BOM.csv");
    expect(bomExportFileName("Blinker", "kicad")).toBe("Blinker-KiCad-BOM.csv");
    expect(bomExportFileName("Blinker", "pnp")).toBe("Blinker-PnP.csv");
  });

  test("the download routes name files after the design", async () => {
    const { sdk, server } = await bootDesignerRuntime("export-naming");
    const design = await sdk.createDesign({ name: "Dual LED Blinker" });
    const get = (file: string) =>
      server.fetch(
        new Request(
          `http://localhost/api/modules/designer/designs/${design.id}/exports/${file}`,
        ),
      );
    const expected: Array<[string, string]> = [
      ["bom.csv", "Dual_LED_Blinker-BOM.csv"],
      ["bom.tsv", "Dual_LED_Blinker-BOM.tsv"],
      ["bom-jlc.csv", "Dual_LED_Blinker-JLC-BOM.csv"],
      ["kicad-bom.csv", "Dual_LED_Blinker-KiCad-BOM.csv"],
      ["pnp.csv", "Dual_LED_Blinker-PnP.csv"],
    ];
    for (const [file, name] of expected) {
      const response = await get(file);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="${name}"`,
      );
    }

    const summary = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/exports/gerber?format=summary`,
        { method: "POST" },
      ),
    );
    expect(summary.status).toBe(200);
    const body = (await summary.json()) as {
      data: { bundleName: string; files: Array<{ fileName: string }> };
    };
    expect(body.data.bundleName).toBe("Dual_LED_Blinker");
    expect(
      body.data.files.every((f) => f.fileName.startsWith("Dual_LED_Blinker")),
    ).toBe(true);
  });
});
