import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";
import { PresetCatalogRepository } from "./preset-catalog-repository";
import { QueryLogger } from "../query-logger";

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

describe("PresetCatalogRepository", () => {
  let repo: PresetCatalogRepository;
  let sqlite: Database;

  beforeEach(() => {
    const { db, sqlite: s } = createTestDb();
    sqlite = s;
    repo = new PresetCatalogRepository(
      db,
      new QueryLogger({ enableLogging: false }),
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  test("creates catalog and variants", async () => {
    const catalog = await repo.create({
      name: "SMD Chip",
      scope: "built_in",
      isImmutable: true,
    });
    expect(catalog.id).toBeTruthy();
    expect(catalog.isImmutable).toBe(true);

    await repo.createVariant({
      catalogId: catalog.id,
      canonicalCode: "0603",
      humanLabel: "0603 / 1608 Metric",
      imperialAlias: "0603",
      metricAlias: "1608",
      mountType: "smd",
      pinCount: 2,
    });

    const variants = await repo.findVariantsByCatalog(catalog.id);
    expect(variants.length).toBe(1);
    expect(variants[0]!.canonicalCode).toBe("0603");
  });

  test("findByScope filters correctly", async () => {
    await repo.create({
      name: "Built-in A",
      scope: "built_in",
      isImmutable: true,
    });
    await repo.create({
      name: "Workspace B",
      scope: "workspace",
      isImmutable: false,
    });

    const builtIn = await repo.findByScope("built_in");
    expect(builtIn.length).toBe(1);

    const workspace = await repo.findByScope("workspace");
    expect(workspace.length).toBe(1);
  });

  test("duplicate preset detaches from source", async () => {
    const source = await repo.create({
      name: "SMD Chip",
      scope: "built_in",
      isImmutable: true,
    });
    await repo.createVariant({
      catalogId: source.id,
      canonicalCode: "0603",
      humanLabel: "0603 / 1608 Metric",
      imperialAlias: "0603",
      metricAlias: "1608",
      mountType: "smd",
      pinCount: 2,
    });

    const dup = await repo.duplicateToWorkspace(source.id, "My Custom Chips");

    expect(dup.scope).toBe("workspace");
    expect(dup.isImmutable).toBe(false);
    expect(dup.id).not.toBe(source.id);

    const dupVariants = await repo.findVariantsByCatalog(dup.id);
    expect(dupVariants.length).toBe(1);
    expect(dupVariants[0]!.catalogId).toBe(dup.id);
    expect(dupVariants[0]!.canonicalCode).toBe("0603");

    // Source unchanged
    const srcVariants = await repo.findVariantsByCatalog(source.id);
    expect(srcVariants.length).toBe(1);
  });
});
