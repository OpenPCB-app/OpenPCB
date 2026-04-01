import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../schema";
import { ComponentFamilyRepository } from "./component-family-repository";
import { QueryLogger } from "../query-logger";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });

  // Create tables manually for in-memory testing
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS component_family (
      id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL,
      display_label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL,
      symbol_data TEXT NOT NULL,
      default_package_variant_id TEXT,
      category_path TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_component_family_scope_key ON component_family(scope, canonical_key);
    CREATE INDEX IF NOT EXISTS idx_component_family_scope ON component_family(scope);

    CREATE TABLE IF NOT EXISTS package_variant (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES component_family(id) ON DELETE CASCADE,
      canonical_code TEXT NOT NULL,
      human_label TEXT NOT NULL,
      imperial_alias TEXT,
      metric_alias TEXT,
      mount_type TEXT NOT NULL,
      dimensions TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      pin_remap_table TEXT,
      default_footprint_option_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS footprint_option (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL REFERENCES package_variant(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      kicad_payload TEXT,
      default_model_3d_option_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS model_3d_option (
      id TEXT PRIMARY KEY,
      footprint_option_id TEXT NOT NULL REFERENCES footprint_option(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      link_status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS manufacturer_offering (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL REFERENCES package_variant(id) ON DELETE CASCADE,
      mpn TEXT NOT NULL,
      manufacturer TEXT NOT NULL,
      datasheet_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS component_revision (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES component_family(id) ON DELETE CASCADE,
      revision_number INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      published_at TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  return { db, sqlite };
}

describe("ComponentFamilyRepository", () => {
  let repo: ComponentFamilyRepository;
  let sqlite: Database;

  beforeEach(() => {
    const { db, sqlite: s } = createTestDb();
    sqlite = s;
    const logger = new QueryLogger({ enableLogging: false });
    repo = new ComponentFamilyRepository(db, logger);
  });

  afterEach(() => {
    sqlite.close();
  });

  test("creates and retrieves a family", async () => {
    const family = await repo.create({
      canonicalKey: "resistor",
      displayLabel: "Resistor",
      description: "Generic resistor",
      scope: "built_in",
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
    });

    expect(family.id).toBeTruthy();
    expect(family.canonicalKey).toBe("resistor");
    expect(family.scope).toBe("built_in");

    const found = await repo.findById(family.id);
    expect(found).not.toBeNull();
    expect(found!.displayLabel).toBe("Resistor");
  });

  test("findByScope returns only matching scope", async () => {
    await repo.create({
      canonicalKey: "resistor",
      displayLabel: "Resistor",
      scope: "built_in",
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
    });
    await repo.create({
      canonicalKey: "my_cap",
      displayLabel: "My Capacitor",
      scope: "workspace",
      symbolData: { referencePrefix: "C", pinDefinitions: [], properties: {} },
    });

    const builtIn = await repo.findByScope("built_in");
    expect(builtIn.length).toBe(1);
    expect(builtIn[0]!.canonicalKey).toBe("resistor");

    const workspace = await repo.findByScope("workspace");
    expect(workspace.length).toBe(1);
    expect(workspace[0]!.canonicalKey).toBe("my_cap");
  });

  test("findByScopeAndKey returns exact match", async () => {
    await repo.create({
      canonicalKey: "resistor",
      displayLabel: "Resistor",
      scope: "built_in",
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
    });

    const found = await repo.findByScopeAndKey("built_in", "resistor");
    expect(found).not.toBeNull();
    expect(found!.displayLabel).toBe("Resistor");

    const notFound = await repo.findByScopeAndKey("workspace", "resistor");
    expect(notFound).toBeNull();
  });

  test("creates variant under family", async () => {
    const family = await repo.create({
      canonicalKey: "capacitor",
      displayLabel: "Capacitor",
      scope: "built_in",
      symbolData: { referencePrefix: "C", pinDefinitions: [], properties: {} },
    });

    const variant = await repo.createVariant({
      familyId: family.id,
      canonicalCode: "0603",
      humanLabel: "0603 / 1608 Metric",
      imperialAlias: "0603",
      metricAlias: "1608",
      mountType: "smd",
      isDefault: true,
    });

    expect(variant.id).toBeTruthy();
    expect(variant.canonicalCode).toBe("0603");

    const variants = await repo.findVariantsByFamily(family.id);
    expect(variants.length).toBe(1);
  });

  test("creates footprint under variant", async () => {
    const family = await repo.create({
      canonicalKey: "cap",
      displayLabel: "Cap",
      scope: "built_in",
      symbolData: { referencePrefix: "C", pinDefinitions: [], properties: {} },
    });
    const variant = await repo.createVariant({
      familyId: family.id,
      canonicalCode: "0603",
      humanLabel: "0603",
      mountType: "smd",
      isDefault: true,
    });

    const fp = await repo.createFootprint({
      variantId: variant.id,
      label: "Nominal",
      isDefault: true,
    });

    expect(fp.id).toBeTruthy();
    expect(fp.label).toBe("Nominal");

    const fps = await repo.findFootprintsByVariant(variant.id);
    expect(fps.length).toBe(1);
  });

  test("creates revision and finds latest", async () => {
    const family = await repo.create({
      canonicalKey: "res",
      displayLabel: "Res",
      scope: "built_in",
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
    });

    await repo.createRevision({
      familyId: family.id,
      revisionNumber: 1,
      snapshot: { displayLabel: "Res v1" },
      publishedAt: "2026-03-31T00:00:00.000Z",
    });
    await repo.createRevision({
      familyId: family.id,
      revisionNumber: 2,
      snapshot: { displayLabel: "Res v2" },
      publishedAt: "2026-03-31T01:00:00.000Z",
    });

    const latest = await repo.findLatestRevision(family.id);
    expect(latest).not.toBeNull();
    expect(latest!.revisionNumber).toBe(2);
  });

  test("soft delete excludes from findByScope", async () => {
    const family = await repo.create({
      canonicalKey: "deleted_res",
      displayLabel: "Deleted",
      scope: "workspace",
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
    });

    await repo.softDelete(family.id);

    const results = await repo.findByScope("workspace");
    expect(results.length).toBe(0);
  });

  test("search matches displayLabel and canonicalKey", async () => {
    await repo.create({
      canonicalKey: "ceramic_capacitor",
      displayLabel: "Ceramic Capacitor",
      scope: "built_in",
      symbolData: { referencePrefix: "C", pinDefinitions: [], properties: {} },
    });
    await repo.create({
      canonicalKey: "resistor",
      displayLabel: "Resistor",
      scope: "built_in",
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
    });

    const byLabel = await repo.search("Ceramic");
    expect(byLabel.length).toBe(1);

    const byKey = await repo.search("resistor");
    expect(byKey.length).toBe(1);
  });
});
