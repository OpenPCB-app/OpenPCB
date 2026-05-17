/**
 * F3 integration test against a real-world KiCad v6+ project ZIP.
 *
 * Uses the user-supplied `data/KiCad_Example_Project_USBtoUART.zip` (USB ↔
 * UART converter design). Asserts the full pipeline can:
 *   - Resolve project files (filter __MACOSX, .DS_Store, *-backups, *.lck).
 *   - Parse the .kicad_pro / .kicad_sch / .kicad_pcb.
 *   - Build a meaningful inspect report.
 *   - Commit a design with persisted schematic + PCB entities.
 *
 * The test is sized to be tolerant of project variation: it asserts
 * lower-bounds on counts (≥ 1 of each kind) rather than exact numbers, so it
 * keeps working as KiCad project authoring conventions evolve.
 */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function bootRuntime(): Promise<DesignerSDK> {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  return moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
}

const FIXTURE_PATH = path.resolve(
  import.meta.dir,
  "../../../../data/KiCad_Example_Project_USBtoUART.zip",
);

describe("KiCad project import — USB-to-UART real fixture", () => {
  test("inspect parses the bundled real project ZIP", async () => {
    isolateTestDb("f3-real-inspect");
    const sdk = await bootRuntime();
    const bytes = new Uint8Array(await readFile(FIXTURE_PATH));

    const report = await sdk.inspectKicadProject(
      "KiCad_Example_Project_USBtoUART.zip",
      bytes,
    );

    expect(report.projectName.length).toBeGreaterThan(0);
    // Real PCB has 2 copper layers (F.Cu + B.Cu).
    expect(report.copperLayerCount).toBe(2);
    // At least one sheet (root) — hierarchical sheets are flattened in v1.
    expect(report.schematicSheetCount).toBeGreaterThanOrEqual(1);
    expect(report.netCount).toBeGreaterThan(0);
    expect(report.counts.schematicSymbols).toBeGreaterThan(0);
    expect(report.counts.pcbFootprints).toBeGreaterThan(0);
    // The project ships with traces + vias.
    expect(report.counts.pcbSegments).toBeGreaterThan(0);
    expect(report.boardOutlineMm).not.toBeNull();
  });

  test("commit persists design + schematic + PCB entities", async () => {
    isolateTestDb("f3-real-commit");
    const sdk = await bootRuntime();
    const bytes = new Uint8Array(await readFile(FIXTURE_PATH));

    const result = await sdk.commitKicadProject({
      archiveFileName: "KiCad_Example_Project_USBtoUART.zip",
      archiveBytes: bytes,
    });

    expect(result.designId).toBeDefined();
    expect(result.designName.length).toBeGreaterThan(0);
    expect(result.applied.copperLayerCount).toBe(2);
    expect(result.applied.boardOutline).toBe(true);
    expect(result.applied.netClassesIngested).toBeGreaterThanOrEqual(1);
    // The full pipeline runs end-to-end on real data — no deferreds.
    expect(result.applied.deferred).toEqual([]);

    // Projection should reflect the persisted design.
    const schematic = await sdk.getSchematicProjection(result.designId);
    expect(schematic).not.toBeNull();
    expect(schematic?.parts.length ?? 0).toBeGreaterThan(0);

    const pcb = await sdk.getPcbProjection(result.designId);
    expect(pcb).not.toBeNull();
    expect(pcb?.board.outline.widthMm).toBeGreaterThan(0);
    expect(pcb?.board.outline.heightMm).toBeGreaterThan(0);
    expect(pcb?.placements.length ?? 0).toBeGreaterThan(0);
    expect(pcb?.traces.length ?? 0).toBeGreaterThan(0);
  });
});
