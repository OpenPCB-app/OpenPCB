import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../db/schema";
import { PresetCatalogRepository } from "../../db/repositories/preset-catalog-repository";
import { PresetCatalogService } from "./preset-catalog-service";
import { QueryLogger } from "../../db/query-logger";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS preset_catalog (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL,
      is_immutable INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS preset_variant (
      id TEXT PRIMARY KEY, catalog_id TEXT NOT NULL REFERENCES preset_catalog(id) ON DELETE CASCADE,
      canonical_code TEXT NOT NULL, human_label TEXT NOT NULL, imperial_alias TEXT, metric_alias TEXT,
      mount_type TEXT NOT NULL, typical_dimensions TEXT, pin_count INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  return { db, sqlite };
}

describe("PresetCatalogService", () => {
  let svc: PresetCatalogService;
  let repo: PresetCatalogRepository;
  let sqlite: Database;

  beforeEach(() => {
    const { db, sqlite: s } = createTestDb();
    sqlite = s;
    repo = new PresetCatalogRepository(
      db,
      new QueryLogger({ enableLogging: false }),
    );
    svc = new PresetCatalogService(repo);
  });

  afterEach(() => {
    sqlite.close();
  });

  test("seeds built-in catalogs with resistor and capacitor presets", async () => {
    await svc.seedBuiltIns();

    const all = await svc.listAll();
    expect(all.length).toBe(3); // SMD Chip Resistor, SMD Chip Capacitor, Electrolytic Capacitor

    const resistor = all.find((c) => c.catalog.name === "SMD Chip Resistor");
    expect(resistor).toBeDefined();
    expect(resistor!.catalog.isImmutable).toBe(true);
    expect(resistor!.variants.length).toBe(8); // 0201-2512

    const capChip = all.find((c) => c.catalog.name === "SMD Chip Capacitor");
    expect(capChip).toBeDefined();
    expect(capChip!.variants.length).toBe(8);

    const capElec = all.find(
      (c) => c.catalog.name === "Electrolytic Capacitor",
    );
    expect(capElec).toBeDefined();
    expect(capElec!.variants.length).toBe(5);
  });

  test("seed is idempotent", async () => {
    await svc.seedBuiltIns();
    await svc.seedBuiltIns(); // should not duplicate

    const all = await svc.listAll();
    expect(all.length).toBe(3);
  });

  test("variants have correct imperial/metric labels", async () => {
    await svc.seedBuiltIns();
    const all = await svc.listAll();
    const resistor = all.find((c) => c.catalog.name === "SMD Chip Resistor")!;

    const v0603 = resistor.variants.find((v) => v.canonicalCode === "0603");
    expect(v0603).toBeDefined();
    expect(v0603!.humanLabel).toBe("0603 / 1608 Metric");
    expect(v0603!.imperialAlias).toBe("0603");
    expect(v0603!.metricAlias).toBe("1608");
    expect(v0603!.mountType).toBe("smd");
    expect(v0603!.pinCount).toBe(2);
  });

  test("listByScope filters correctly", async () => {
    await svc.seedBuiltIns();

    const builtIn = await svc.listByScope("built_in");
    expect(builtIn.length).toBe(3);

    const workspace = await svc.listByScope("workspace");
    expect(workspace.length).toBe(0);
  });

  test("duplicate preset detaches from built-in", async () => {
    await svc.seedBuiltIns();
    const all = await svc.listAll();
    const source = all.find((c) => c.catalog.name === "SMD Chip Resistor")!;

    const dup = await svc.duplicateToWorkspace(
      source.catalog.id,
      "My Resistors",
    );

    expect(dup.catalog.scope).toBe("workspace");
    expect(dup.catalog.isImmutable).toBe(false);
    expect(dup.catalog.name).toBe("My Resistors");
    expect(dup.variants.length).toBe(source.variants.length);

    // Verify detached: IDs differ
    expect(dup.catalog.id).not.toBe(source.catalog.id);
    for (const dv of dup.variants) {
      expect(source.variants.every((sv) => sv.id !== dv.id)).toBe(true);
    }
  });

  test("electrolytic presets have height dimensions", async () => {
    await svc.seedBuiltIns();
    const all = await svc.listAll();
    const elec = all.find((c) => c.catalog.name === "Electrolytic Capacitor")!;

    const v = elec.variants.find((v) => v.canonicalCode === "6.3x5.4");
    expect(v).toBeDefined();
    const dims = v!.typicalDimensions as {
      lengthMm: number;
      widthMm: number;
      heightMm: number;
    };
    expect(dims.heightMm).toBe(5.4);
    expect(dims.lengthMm).toBe(6.3);
  });
});
