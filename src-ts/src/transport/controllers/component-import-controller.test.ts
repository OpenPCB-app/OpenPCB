import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { RouteContext } from "../router";
import { RouteParams } from "../router/route-parser";
import { ComponentImportController } from "./component-import-controller";
import type { ComponentImportService } from "../../domain/services/component-import-service";
import type { DatabaseAccess } from "../../db";

const FIXTURES_DIR = join(import.meta.dir, "../../infrastructure/parsers/kicad/__fixtures__");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

function createContext(request: Request): RouteContext {
  return {
    req: request,
    params: new RouteParams({}),
    query: new URL(request.url).searchParams,
    url: new URL(request.url),
  };
}

function createDbMock() {
  return {
    componentFamilies: {
      create: mock(async () => ({ id: "family-1" })),
      createVariant: mock(async () => ({ id: "variant-1" })),
      createFootprint: mock(async () => ({ id: "footprint-1" })),
      createModel3d: mock(async () => ({ id: "model-1" })),
    },
    componentProvenance: {
      create: mock(async () => ({ id: "prov-1" })),
    },
  } as unknown as DatabaseAccess;
}

describe("ComponentImportController", () => {
  it("parses a KiCad symbol file", async () => {
    const controller = new ComponentImportController(
      { generatePreview: mock(() => ({ groups: [], ungroupedFiles: [], totalWarnings: 0 })) } as unknown as ComponentImportService,
      createDbMock(),
    );

    const response = await controller.parseSymbol(
      createContext(
        new Request("http://localhost/api/components/import/parse-symbol", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: readFixture("simple_resistor.kicad_sym"),
            fileName: "simple_resistor.kicad_sym",
          }),
        }),
      ),
    );
    const json = await response.json() as any;

    expect(response.status).toBe(200);
    expect(json.data.symbol.name).toBe("R");
    expect(json.data.symbol.pins.length).toBe(2);
  });

  it("parses a KiCad footprint file", async () => {
    const controller = new ComponentImportController(
      { generatePreview: mock(() => ({ groups: [], ungroupedFiles: [], totalWarnings: 0 })) } as unknown as ComponentImportService,
      createDbMock(),
    );

    const response = await controller.parseFootprint(
      createContext(
        new Request("http://localhost/api/components/import/parse-footprint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: readFixture("C_0603_1608Metric.kicad_mod"),
            fileName: "C_0603_1608Metric.kicad_mod",
          }),
        }),
      ),
    );
    const json = await response.json() as any;

    expect(response.status).toBe(200);
    expect(json.data.footprint.name).toBe("C_0603_1608Metric");
    expect(json.data.footprint.pads.length).toBe(2);
  });

  it("previews multipart KiCad imports", async () => {
    const generatePreview = mock(() => ({
      groups: [{ canonicalKey: "c0603", variants: [], warnings: [] }],
      ungroupedFiles: [],
      totalWarnings: 0,
    }));
    const controller = new ComponentImportController(
      { generatePreview } as unknown as ComponentImportService,
      createDbMock(),
    );

    const formData = new FormData();
    formData.append(
      "footprint",
      new File([readFixture("C_0603_1608Metric.kicad_mod")], "C_0603_1608Metric.kicad_mod"),
    );
    formData.append("model", new File(["step"], "C_0603_1608Metric.step"));

    const response = await controller.previewImport(
      createContext(
        new Request("http://localhost/api/components/import/preview", {
          method: "POST",
          body: formData,
        }),
      ),
    );
    const json = await response.json() as any;

    expect(response.status).toBe(200);
    expect(generatePreview).toHaveBeenCalled();
    expect(json.data.preview.groups).toHaveLength(1);
  });

  it("confirms imports and stores provenance, footprints, and model links", async () => {
    const db = createDbMock();
    const controller = new ComponentImportController(
      { generatePreview: mock(() => ({ groups: [], ungroupedFiles: [], totalWarnings: 0 })) } as unknown as ComponentImportService,
      db,
    );

    const response = await controller.confirmImport(
      createContext(
        new Request("http://localhost/api/components/import/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: [
              {
                fileName: "simple_capacitor.kicad_sym",
                content: readFixture("simple_capacitor.kicad_sym"),
              },
              {
                fileName: "C_0603_1608Metric.kicad_mod",
                content: readFixture("C_0603_1608Metric.kicad_mod"),
              },
            ],
            groups: [
              {
                familyLabel: "Capacitor 0603",
                canonicalKey: "capacitor_0603",
                categoryPath: "Capacitors > Ceramic",
                symbolFileName: "simple_capacitor.kicad_sym",
                variants: [
                  {
                    canonicalCode: "0603",
                    humanLabel: "0603",
                    mountType: "smd",
                    footprintFileNames: ["C_0603_1608Metric.kicad_mod"],
                    model3dFileNames: ["C_0603_1608Metric.step"],
                  },
                ],
              },
            ],
          }),
        }),
      ),
    );
    const json = await response.json() as any;

    expect(response.status).toBe(200);
    expect(json.data.familyIds).toEqual(["family-1"]);
    expect(db.componentFamilies.create).toHaveBeenCalled();
    expect(db.componentFamilies.createFootprint).toHaveBeenCalled();
    expect(db.componentFamilies.createModel3d).toHaveBeenCalled();
    expect(db.componentProvenance.create).toHaveBeenCalled();
  });
});
