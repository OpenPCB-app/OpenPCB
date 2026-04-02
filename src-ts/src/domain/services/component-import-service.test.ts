import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { UniqueConstraintError } from "../../db/errors";
import { ComponentImportService } from "./component-import-service";

const FIXTURES_DIR = join(
  import.meta.dir,
  "../../infrastructure/parsers/kicad/__fixtures__",
);

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("ComponentImportService", () => {
  test("imports grouped KiCad symbol and footprint files through immediate create-only flow", async () => {
    const createComponent = mock(async (input: Record<string, any>) => ({
      component: {
        id: "component-1",
        canonicalKey: input.canonicalKey,
        displayLabel: input.displayLabel,
      },
      variants: input.variants.map(
        (variant: Record<string, any>, index: number) => ({
          id: `variant-${index + 1}`,
          ...variant,
        }),
      ),
    }));
    const service = new ComponentImportService({ createComponent } as never);

    const result = await service.importFiles([
      {
        fileName: "simple_capacitor.kicad_sym",
        content: readFixture("simple_capacitor.kicad_sym"),
      },
      {
        fileName: "C_0603_1608Metric.kicad_mod",
        content: readFixture("C_0603_1608Metric.kicad_mod"),
      },
      { fileName: "C_0603_1608Metric.step" },
    ]);

    expect(createComponent).toHaveBeenCalledTimes(1);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toEqual({
      componentId: "component-1",
      displayLabel: expect.stringContaining("Capacitor"),
      canonicalKey: expect.any(String),
      variantCount: 1,
      sourceFileNames: [
        "simple_capacitor.kicad_sym",
        "C_0603_1608Metric.kicad_mod",
      ],
    });

    const input = createComponent.mock.calls[0]?.[0];
    expect(input.displayLabel.toLowerCase()).toContain("capacitor");
    expect(input.variants).toHaveLength(1);
    expect(
      input.variants[0]?.footprintOptions?.[0]?.kicadPayload?.importProvenance
        ?.sourceFileName,
    ).toBe("C_0603_1608Metric.kicad_mod");
    expect(input.symbolData.importProvenance.sourceFileName).toBe(
      "simple_capacitor.kicad_sym",
    );
  });

  test("retries with a suffixed canonical key when create-only import hits an existing component", async () => {
    const attemptedKeys: string[] = [];
    const createComponent = mock(async (input: Record<string, any>) => {
      attemptedKeys.push(input.canonicalKey);
      if (input.canonicalKey === "r") {
        throw new UniqueConstraintError(
          "components.canonical_key",
          "Duplicate canonical key",
        );
      }

      return {
        component: {
          id: "component-duplicate",
          canonicalKey: input.canonicalKey,
          displayLabel: input.displayLabel,
        },
        variants: input.variants.map(
          (variant: Record<string, any>, index: number) => ({
            id: `variant-${index + 1}`,
            ...variant,
          }),
        ),
      };
    });
    const service = new ComponentImportService({ createComponent } as never);

    const result = await service.importFiles([
      {
        fileName: "simple_resistor.kicad_sym",
        content: readFixture("simple_resistor.kicad_sym"),
      },
    ]);

    expect(createComponent).toHaveBeenCalledTimes(2);
    expect(attemptedKeys).toEqual(["r", "r-2"]);
    expect(result.components[0]).toMatchObject({
      componentId: "component-duplicate",
      canonicalKey: "r-2",
      variantCount: 1,
    });
  });

  test("creates symbol-only virtual components when no footprints are provided", async () => {
    const createComponent = mock(async (input: Record<string, any>) => ({
      component: {
        id: "component-2",
        canonicalKey: input.canonicalKey,
        displayLabel: input.displayLabel,
      },
      variants: input.variants.map(
        (variant: Record<string, any>, index: number) => ({
          id: `variant-${index + 1}`,
          ...variant,
        }),
      ),
    }));
    const service = new ComponentImportService({ createComponent } as never);

    const result = await service.importFiles([
      {
        fileName: "simple_resistor.kicad_sym",
        content: readFixture("simple_resistor.kicad_sym"),
      },
    ]);

    expect(result.components).toHaveLength(1);
    const input = createComponent.mock.calls[0]?.[0];
    expect(input.variants[0]?.mountType).toBe("virtual");
    expect(input.symbolData.referencePrefix).toBe("R");
  });

  test("reports warnings for missing 3D model targets while still importing", async () => {
    const createComponent = mock(async (input: Record<string, any>) => ({
      component: {
        id: "component-3",
        canonicalKey: input.canonicalKey,
        displayLabel: input.displayLabel,
      },
      variants: input.variants.map(
        (variant: Record<string, any>, index: number) => ({
          id: `variant-${index + 1}`,
          ...variant,
        }),
      ),
    }));
    const service = new ComponentImportService({ createComponent } as never);

    const result = await service.importFiles([
      {
        fileName: "missing_3d_footprint.kicad_mod",
        content: readFixture("missing_3d_footprint.kicad_mod"),
      },
    ]);

    expect(result.components).toHaveLength(1);
    expect(
      result.warnings.some((warning) => warning.code === "missing_3d_model"),
    ).toBe(true);
  });
});
