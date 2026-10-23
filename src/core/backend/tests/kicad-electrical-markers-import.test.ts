import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { parseKicadSchematic } from "../../../modules/library/backend/infrastructure/parsers/kicad/kicad-schematic-parser";
import { buildInspectReport } from "../../../modules/designer/backend/import/kicad-project/inspect";
import { insertSchematicEntities } from "../../../modules/designer/backend/import/kicad-project/insert-schematic";
import { getSharedDb, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { openReceiptStore } from "./designer-operation-receipts-harness";

const originalDbPath = process.env.OPENPCB_DB_PATH;
const originalCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;

afterEach(() => {
  resetSharedSqliteForTesting();
  if (originalDbPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = originalDbPath;
  if (originalCapture === undefined)
    delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = originalCapture;
});

function symbol(
  libId: string,
  reference: string,
  value: string,
  x: number,
): string {
  return `(symbol (lib_id "${libId}") (at ${x} 0 0)
    (property "Reference" "${reference}") (property "Value" "${value}"))`;
}

function suppliesWithFlags(flagValue: string): string {
  return `(kicad_sch (version 20231120)
    ${symbol("power:VCC", "#PWR01", "VCC", 0)}
    ${symbol("power:PWR_FLAG", "#FLG01", flagValue, 0)}
    ${symbol("power:GND", "#PWR02", "GND", 20)}
    ${symbol("power:PWR_FLAG", "#FLG02", flagValue, 20)})`;
}

async function inspect(source: string) {
  return buildInspectReport(
    {
      projectFileName: "markers.kicad_pro",
      projectContent: "{}",
      pcbFileName: "markers.kicad_pcb",
      pcbContent: `(kicad_pcb (version 20231120)
      (layers (0 "F.Cu" signal) (31 "B.Cu" signal)))`,
      schematicSheets: [{ fileName: "markers.kicad_sch", content: source }],
    },
    async () => null,
  );
}

async function importSchematic(source: string) {
  const store = await openReceiptStore(
    path.join(
      os.tmpdir(),
      `kicad-electrical-markers-${crypto.randomUUID()}.sqlite`,
    ),
  );
  const design = await store.createDesign();
  const sheet = parseKicadSchematic(source);
  const inserted = insertSchematicEntities(
    getSharedDb(),
    {
      designId: design.id,
      schematics: [sheet],
      componentByRefdes: new Map(),
      placementDetailByComponentId: new Map(),
    },
    new Date().toISOString(),
  );
  const projection = (await store.getSchematicProjection(design.id))!;
  return { sheet, inserted, projection };
}

describe("KiCad electrical marker import", () => {
  for (const flagValue of ["PWR_FLAG", "External supply"]) {
    test(`PWR_FLAG identity survives display value '${flagValue}'`, () => {
      const parsed = parseKicadSchematic(suppliesWithFlags(flagValue));
      expect(
        parsed.powerSymbols.filter((power) =>
          power.reference.startsWith("#FLG"),
        ),
      ).toEqual([
        expect.objectContaining({
          libId: "power:PWR_FLAG",
          reference: "#FLG01",
        }),
        expect.objectContaining({
          libId: "power:PWR_FLAG",
          reference: "#FLG02",
        }),
      ]);
    });

    test(`inspect warns that '${flagValue}' power-source assertions are omitted`, async () => {
      const report = await inspect(suppliesWithFlags(flagValue));
      const warnings = report.warnings.filter(
        (warning) => warning.code === "kicad_power_flag_unsupported",
      );
      expect(warnings).toHaveLength(2);
      for (const warning of warnings) {
        expect(warning.severity).toBe("warning");
        expect(warning.message).toContain("power-source assertion");
        expect(warning.message).toContain("omitted");
        expect(warning.message).toContain("Review");
      }
      expect(warnings[0]?.message).toContain("#FLG01");
      expect(warnings[1]?.message).toContain("#FLG02");
    });

    test(`two '${flagValue}' markers cannot join VCC and GND`, async () => {
      const { inserted, projection } = await importSchematic(
        suppliesWithFlags(flagValue),
      );
      expect(inserted.primitivesInserted).toBe(2);
      expect(
        projection.primitives.map((primitive) => primitive.kind).sort(),
      ).toEqual(["gnd", "pwr"]);
      expect(projection.nets.map((net) => net.name).sort()).toEqual([
        "GND",
        "VCC",
      ]);
      expect(projection.nets).toHaveLength(2);
    });
  }

  test("ordinary power symbols retain global net naming, even when named PWR_FLAG", async () => {
    const source = `(kicad_sch (version 20231120)
      ${symbol("power:VCC", "#PWR01", "PWR_FLAG", 0)}
      ${symbol("power:VCC", "#PWR02", "PWR_FLAG", 20)}
      ${symbol("power:GNDA", "#PWR03", "GNDA", 40)}
      ${symbol("power:GND", "#PWR04", "GND", 60)})`;
    const { sheet, inserted, projection } = await importSchematic(source);
    expect(
      sheet.warnings.some(
        (warning) => warning.code === "kicad_power_flag_unsupported",
      ),
    ).toBe(false);
    expect(inserted.primitivesInserted).toBe(4);
    expect(projection.nets.map((net) => net.name).sort()).toEqual([
      "GND",
      "GNDA",
      "PWR_FLAG",
    ]);
  });

  test("inspect reports dropped no-connect intent without hiding marker count", async () => {
    const source = `(kicad_sch (version 20231120)
      (no_connect (at 0 0) (uuid "nc1"))
      (no_connect (at 10 0) (uuid "nc2")))`;
    const report = await inspect(source);
    expect(report.counts.schematicNoConnects).toBe(2);
    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        code: "kicad_no_connect_unsupported",
        severity: "warning",
      }),
    );
    const warning = report.warnings.find(
      (entry) => entry.code === "kicad_no_connect_unsupported",
    )!;
    expect(warning.message).toContain("2");
    expect(warning.message).toContain("omitted");
    expect(warning.message).toContain("Review");
  });
});
