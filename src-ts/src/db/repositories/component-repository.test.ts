import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";
import { QueryLogger } from "../query-logger";
import { DbConflictError } from "../errors";
import { ComponentRepository } from "./component-repository";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL,
      display_label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'workspace',
      symbol_data TEXT NOT NULL,
      default_variant_id TEXT,
      category_path TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_components_scope_canonical_key
      ON components(scope, canonical_key);

    CREATE TABLE IF NOT EXISTS component_variants (
      id TEXT PRIMARY KEY,
      component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
      canonical_code TEXT NOT NULL,
      human_label TEXT NOT NULL,
      imperial_alias TEXT,
      metric_alias TEXT,
      mount_type TEXT NOT NULL,
      dimensions TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      pin_remap_table TEXT,
      footprint_payload TEXT,
      default_footprint_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_component_variants_component_code
      ON component_variants(component_id, canonical_code);

    CREATE TABLE IF NOT EXISTS component_usage (
      id TEXT PRIMARY KEY,
      component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
      design_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_component_usage_design_component_variant
      ON component_usage(design_id, component_id, variant_id);

    CREATE TABLE IF NOT EXISTS design (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);

  return { db, sqlite };
}

function variant(code: string, label: string, isDefault = false) {
  return {
    canonicalCode: code,
    humanLabel: label,
    imperialAlias: null,
    metricAlias: null,
    mountType: "smd" as const,
    dimensions: { lengthMm: 1.6, widthMm: 0.8, heightMm: null },
    isDefault,
    pinRemapTable: null,
    footprintPayload: { name: `${code}-footprint` },
    defaultFootprintId: null,
  };
}

describe("ComponentRepository", () => {
  let sqlite: Database;
  let repo: ComponentRepository;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    repo = new ComponentRepository(
      testDb.db,
      new QueryLogger({ enableLogging: false }),
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  test("supports canonical component CRUD", async () => {
    const created = await repo.createComponent({
      canonicalKey: "resistor",
      displayLabel: "Resistor",
      description: "Generic resistor",
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
      categoryPath: "passives/resistors",
      tags: ["passive", "resistor"],
      variants: [variant("0603", "0603"), variant("0805", "0805", true)],
    });

    expect(created.component.scope).toBe("workspace");
    expect(created.variants.length).toBe(2);

    const defaultVariant = created.variants.find((item) => item.isDefault);
    expect(defaultVariant).toBeTruthy();
    expect(created.component.defaultVariantId).toBe(defaultVariant!.id);

    const loaded = await repo.getComponent(created.component.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.component.canonicalKey).toBe("resistor");
    expect(loaded!.variants.length).toBe(2);

    const updated = await repo.updateComponent(created.component.id, {
      displayLabel: "Precision Resistor",
      description: "Thin film resistor",
      categoryPath: "passives/resistors/thin-film",
      tags: ["precision", "passive"],
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: { tolerance: "1%" } },
    });

    expect(updated.component.displayLabel).toBe("Precision Resistor");
    expect(updated.component.description).toBe("Thin film resistor");
    expect(updated.component.categoryPath).toBe("passives/resistors/thin-film");
    expect(updated.component.tags).toEqual(["precision", "passive"]);
    expect(updated.component.symbolData).toEqual({
      referencePrefix: "R",
      pinDefinitions: [],
      properties: { tolerance: "1%" },
    });

    await repo.deleteComponent(created.component.id);
    expect(await repo.getComponent(created.component.id)).toBeNull();
  });

  test("listComponents supports search, mountType, and categoryPath filters", async () => {
    await repo.createComponent({
      canonicalKey: "res-1k",
      displayLabel: "Resistor 1k",
      categoryPath: "passives/resistors/chip",
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
      variants: [variant("0603", "0603", true)],
    });

    await repo.createComponent({
      canonicalKey: "hdr-2x1",
      displayLabel: "Header 2x1",
      categoryPath: "connectors/headers/pin",
      symbolData: { referencePrefix: "J", pinDefinitions: [], properties: {} },
      variants: [
        {
          ...variant("TH-2", "TH-2", true),
          mountType: "through_hole" as const,
        },
      ],
    });

    const bySearch = await repo.listComponents({ search: "Resistor" });
    expect(bySearch.length).toBe(1);
    expect(bySearch[0]!.component.canonicalKey).toBe("res-1k");

    const byMountType = await repo.listComponents({ mountType: "through_hole" });
    expect(byMountType.length).toBe(1);
    expect(byMountType[0]!.component.canonicalKey).toBe("hdr-2x1");

    const byCategoryPath = await repo.listComponents({ categoryPath: "passives/resistors" });
    expect(byCategoryPath.length).toBe(1);
    expect(byCategoryPath[0]!.component.canonicalKey).toBe("res-1k");
  });

  test("variant repository supports add/update/remove/setDefault", async () => {
    const created = await repo.createComponent({
      canonicalKey: "inductor",
      displayLabel: "Inductor",
      symbolData: { referencePrefix: "L", pinDefinitions: [], properties: {} },
      variants: [variant("0805", "0805", true)],
    });

    const newVariant = await repo.variants.addVariant(
      created.component.id,
      variant("1206", "1206", false),
    );

    const updatedVariant = await repo.variants.updateVariant(newVariant.id, {
      humanLabel: "1206 metric",
      defaultFootprintId: "fp-1206-default",
    });
    expect(updatedVariant.humanLabel).toBe("1206 metric");
    expect(updatedVariant.defaultFootprintId).toBe("fp-1206-default");

    const defaultVariant = await repo.variants.setDefaultVariant(
      created.component.id,
      newVariant.id,
    );
    expect(defaultVariant.id).toBe(newVariant.id);
    expect(defaultVariant.isDefault).toBe(true);

    const refreshed = await repo.getComponent(created.component.id);
    expect(refreshed!.component.defaultVariantId).toBe(newVariant.id);

    const oldDefault = refreshed!.variants.find((item) => item.canonicalCode === "0805")!;
    await repo.variants.removeVariant(oldDefault.id);

    const afterRemove = await repo.getComponent(created.component.id);
    expect(afterRemove!.variants.length).toBe(1);

    await expect(repo.variants.removeVariant(afterRemove!.variants[0]!.id)).rejects.toThrow(
      "Cannot remove the only variant",
    );
  });

  test("deleteComponent throws DbConflictError when the component is referenced", async () => {
    const created = await repo.createComponent({
      canonicalKey: "ferrite-bead",
      displayLabel: "Ferrite Bead",
      symbolData: { referencePrefix: "FB", pinDefinitions: [], properties: {} },
      variants: [variant("0603", "0603", true)],
    });

    const defaultVariantId = created.component.defaultVariantId!;

    sqlite.exec(`
      INSERT INTO design (id, workspace_id, name, created_at, updated_at, deleted_at)
      VALUES
        ('design-a', 'ws-1', 'Design A', 1, 1, NULL),
        ('design-b', 'ws-1', 'Design B', 1, 1, NULL);
    `);

    await repo.recordUsage({
      componentId: created.component.id,
      designId: "design-a",
      variantId: defaultVariantId,
    });

    await repo.recordUsage({
      componentId: created.component.id,
      designId: "design-a",
      variantId: defaultVariantId,
    });

    await repo.recordUsage({
      componentId: created.component.id,
      designId: "design-b",
      variantId: defaultVariantId,
    });

    expect(await repo.getUsageCount(created.component.id)).toBe(2);

    await expect(repo.deleteComponent(created.component.id)).rejects.toThrow(DbConflictError);
    await expect(repo.deleteComponent(created.component.id)).rejects.toThrow(
      "in use by 2 design(s)",
    );

    expect(await repo.getComponent(created.component.id)).not.toBeNull();
  });

  test("deleteComponent ignores usage rows for missing or deleted designs", async () => {
    const created = await repo.createComponent({
      canonicalKey: "test-delete-unused",
      displayLabel: "Test Delete Unused",
      symbolData: { referencePrefix: "U", pinDefinitions: [], properties: {} },
      variants: [variant("0603", "0603", true)],
    });

    const defaultVariantId = created.component.defaultVariantId!;

    sqlite.exec(`
      INSERT INTO design (id, workspace_id, name, created_at, updated_at, deleted_at)
      VALUES ('deleted-design', 'ws-1', 'Deleted Design', 1, 1, 1);
    `);

    await repo.recordUsage({
      componentId: created.component.id,
      designId: "missing-design",
      variantId: defaultVariantId,
    });

    await repo.recordUsage({
      componentId: created.component.id,
      designId: "deleted-design",
      variantId: defaultVariantId,
    });

    expect(await repo.getUsageCount(created.component.id)).toBe(0);

    await repo.deleteComponent(created.component.id);
    expect(await repo.getComponent(created.component.id)).toBeNull();
  });
});
