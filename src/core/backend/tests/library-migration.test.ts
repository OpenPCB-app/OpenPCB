import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function isolate(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function bootRuntime(): Promise<ModuleRuntime> {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const runtime = new ModuleRuntime({
    moduleRegistry: new ModuleRouterRegistry(),
    workspaceRoot: repoRoot,
  });
  await runtime.bootstrap();
  return runtime;
}

/** Hand-craft a stale `library_symbols` row whose preview labels still use
 *  pre-KLC font sizes (< 1 mm). Insert directly via raw SQL so the migration
 *  has something to detect. */
function insertStaleSymbol(symbolId: string, name: string): void {
  const db = getSharedSqlite();
  const dataJson = JSON.stringify({
    provenance: {
      sourceKind: "imported",
      sourceFormat: "kicad_sym",
      fileName: "stale.kicad_sym",
      importedAt: new Date().toISOString(),
      sourceHash: "stale-hash-1",
    },
    parser: { warnings: [], properties: {}, units: 1 },
    normalized: {
      id: symbolId,
      name,
      referencePrefix: "U",
      pins: [
        {
          originPinKey: "u1:1",
          number: "1",
          name: "A",
          localPosition: { x: 0, y: 3.81 },
          electricalType: "passive",
          unit: 1,
        },
      ],
      sourceHash: "stale-hash-1",
      warnings: [],
      preview: {
        kind: "symbol",
        units: "mm",
        name,
        unitCount: 1,
        graphics: [
          {
            kind: "line",
            a: { x: -2.54, y: 0 },
            b: { x: 2.54, y: 0 },
            strokeWidthMm: 0.15,
          },
        ],
        pins: [
          {
            id: "u1:1",
            name: "A",
            number: "1",
            electricalType: "passive",
            unit: 1,
            anchor: { x: 0, y: 3.81 },
            bodyEnd: { x: 0, y: 2.54 },
            rotationDeg: 270,
          },
        ],
        // STALE: pre-KLC font sizes. Migration should rewrite these.
        labels: [
          {
            id: "u1:1:name",
            text: "A",
            at: { x: 0, y: 2.04 },
            fontSizeMm: 0.28,
            rotationDeg: 0,
            anchorX: "center",
            anchorY: "middle",
            role: "pin-name",
          },
          {
            id: "symbol:reference",
            text: "U",
            at: { x: 0, y: 4.21 },
            fontSizeMm: 0.35,
            rotationDeg: 0,
            anchorX: "center",
            anchorY: "bottom",
            role: "reference",
          },
        ],
        bounds: { minX: -2.54, minY: -1, maxX: 2.54, maxY: 5 },
        warnings: [],
      },
    },
    raw: {},
  });
  db.query(
    `INSERT INTO library_symbols (id, name, data_json, created_at) VALUES (?, ?, ?, ?)`,
  ).run(symbolId, name, dataJson, new Date().toISOString());
}

function readSymbolDataJson(symbolId: string): Record<string, unknown> {
  const db = getSharedSqlite();
  const row = db
    .query<
      { data_json: string },
      [string]
    >(`SELECT data_json FROM library_symbols WHERE id = ?`)
    .get(symbolId);
  if (!row) throw new Error(`symbol ${symbolId} not found`);
  return JSON.parse(row.data_json) as Record<string, unknown>;
}

describe("library preview-model migration", () => {
  test("rebuilds stale imported symbol on first boot, leaves it alone on second", async () => {
    isolate("library-migration-stale");

    // First runtime applies SQL migrations + builtin seed. The rebuild fires
    // here too but finds nothing stale yet, so it writes its sentinel.
    await bootRuntime();

    // Inject a stale imported row + clear the sentinel so the second boot's
    // rebuild path actually runs (in production the sentinel only locks once
    // because no new code-path can introduce stale rows post-migration).
    insertStaleSymbol("stale-symbol-1", "StaleIC");
    const dbPath = process.env.OPENPCB_DB_PATH;
    expect(dbPath).toBeTruthy();
    getSharedSqlite()
      .query(
        `DELETE FROM openpcb_migrations WHERE module_id = ? AND migration_name = ?`,
      )
      .run("library", "2026_05_07_text_rev2");

    // Reboot — rebuild detects the stale row and rewrites it.
    resetSharedSqliteForTesting();
    process.env.OPENPCB_DB_PATH = dbPath;
    await bootRuntime();

    const refreshed = readSymbolDataJson("stale-symbol-1");
    const provenance = refreshed.provenance as { sourceHash?: string };
    expect(provenance.sourceHash?.endsWith(":text-rev2")).toBe(true);

    const normalized = refreshed.normalized as {
      preview: { labels: Array<{ fontSizeMm: number }> };
    };
    const allFontSizesUpdated = normalized.preview.labels.every(
      (l) => l.fontSizeMm >= 1.0,
    );
    expect(allFontSizesUpdated).toBe(true);

    // Capture rebuilt JSON, then boot AGAIN — sentinel must prevent re-write.
    const before = readSymbolDataJson("stale-symbol-1");
    resetSharedSqliteForTesting();
    process.env.OPENPCB_DB_PATH = dbPath;
    await bootRuntime();
    const after = readSymbolDataJson("stale-symbol-1");
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  test("sentinel row exists in openpcb_migrations after rebuild", async () => {
    isolate("library-migration-sentinel");
    await bootRuntime();
    const db = getSharedSqlite();
    const row = db
      .query<
        { migration_name: string; module_id: string },
        [string, string]
      >(`SELECT module_id, migration_name FROM openpcb_migrations WHERE module_id = ? AND migration_name = ?`)
      .get("library", "2026_05_07_text_rev2");
    expect(row).not.toBeNull();
    expect(row?.module_id).toBe("library");
  });
});
