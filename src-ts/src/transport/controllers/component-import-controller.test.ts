import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { RouteContext } from "../router";
import { RouteParams } from "../router/route-parser";
import { ComponentImportController } from "./component-import-controller";
import type { IComponentImportService } from "../../domain/services/component-import-service";
import type { IComponentZipImportService } from "../../domain/services/component-zip-import-service";
import { parseKicadSymbolLib } from "../../infrastructure/parsers/kicad/kicad-symbol-parser";

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

describe("ComponentImportController", () => {
  it("parses a KiCad symbol file", async () => {
    const controller = new ComponentImportController(
      { importFiles: mock(async () => ({ components: [], warnings: [], ungroupedFiles: [] })) } as unknown as IComponentImportService,
      { importZip: mock(async () => ({ components: [], warnings: [], ungroupedFiles: [] })) } as unknown as IComponentZipImportService,
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
    const json = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(json.data.symbol.name).toBe("R");
    expect(json.data.symbol.pins.length).toBe(2);
  });

  it("parses a serialized symbol node payload", async () => {
    const controller = new ComponentImportController(
      { importFiles: mock(async () => ({ components: [], warnings: [], ungroupedFiles: [] })) } as unknown as IComponentImportService,
      { importZip: mock(async () => ({ components: [], warnings: [], ungroupedFiles: [] })) } as unknown as IComponentZipImportService,
    );

    const parsedLib = parseKicadSymbolLib(readFixture("simple_resistor.kicad_sym"));
    const symbolNode = parsedLib.symbols[0]?.rawSource;
    expect(symbolNode).toBeTruthy();

    const response = await controller.parseSymbol(
      createContext(
        new Request("http://localhost/api/components/import/parse-symbol", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: symbolNode,
            fileName: "R",
          }),
        }),
      ),
    );
    const json = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(json.data.symbol.name).toBe("R");
    expect(json.data.availableSymbols).toEqual(["R"]);
  });

  it("parses a KiCad footprint file", async () => {
    const controller = new ComponentImportController(
      { importFiles: mock(async () => ({ components: [], warnings: [], ungroupedFiles: [] })) } as unknown as IComponentImportService,
      { importZip: mock(async () => ({ components: [], warnings: [], ungroupedFiles: [] })) } as unknown as IComponentZipImportService,
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
    const json = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(json.data.footprint.name).toBe("C_0603_1608Metric");
    expect(json.data.footprint.pads.length).toBe(2);
  });

  it("imports multipart KiCad files through the canonical service", async () => {
    const importFiles = mock(async () => ({
      components: [
        {
          componentId: "component-1",
          displayLabel: "Capacitor 0603",
          canonicalKey: "capacitor-0603",
          variantCount: 1,
          sourceFileNames: ["simple_capacitor.kicad_sym", "C_0603_1608Metric.kicad_mod"],
        },
      ],
      warnings: [],
      ungroupedFiles: [],
    }));
    const importZip = mock(async () => ({ components: [], warnings: [], ungroupedFiles: [] }));
    const controller = new ComponentImportController(
      { importFiles } as unknown as IComponentImportService,
      { importZip } as unknown as IComponentZipImportService,
    );

    const formData = new FormData();
    formData.append(
      "symbol",
      new File([readFixture("simple_capacitor.kicad_sym")], "simple_capacitor.kicad_sym"),
    );
    formData.append(
      "footprint",
      new File([readFixture("C_0603_1608Metric.kicad_mod")], "C_0603_1608Metric.kicad_mod"),
    );

    const response = await controller.importComponents(
      createContext(
        new Request("http://localhost/api/components/import", {
          method: "POST",
          body: formData,
        }),
      ),
    );
    const json = (await response.json()) as any;

    expect(response.status).toBe(201);
    expect(importFiles).toHaveBeenCalled();
    expect(importZip).not.toHaveBeenCalled();
    expect(json.data.import.components).toHaveLength(1);
  });

  it("routes ZIP uploads through the ZIP wrapper", async () => {
    const importFiles = mock(async () => ({ components: [], warnings: [], ungroupedFiles: [] }));
    const importZip = mock(async () => ({
      components: [
        {
          componentId: "component-zip",
          displayLabel: "ZIP Component",
          canonicalKey: "zip-component",
          variantCount: 1,
          sourceFileNames: ["archive.zip"],
        },
      ],
      warnings: [],
      ungroupedFiles: [],
    }));
    const controller = new ComponentImportController(
      { importFiles } as unknown as IComponentImportService,
      { importZip } as unknown as IComponentZipImportService,
    );

    const formData = new FormData();
    formData.append("archive", new File(["zip"], "archive.zip"));

    const response = await controller.importComponents(
      createContext(
        new Request("http://localhost/api/components/import", {
          method: "POST",
          body: formData,
        }),
      ),
    );

    expect(response.status).toBe(201);
    expect(importZip).toHaveBeenCalled();
    expect(importFiles).not.toHaveBeenCalled();
  });
});
