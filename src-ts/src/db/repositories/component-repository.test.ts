import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";
import { QueryLogger } from "../query-logger";
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
      footprint_options TEXT NOT NULL DEFAULT '[]',
      default_footprint_option_id TEXT,
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

    CREATE TABLE IF NOT EXISTS design_sheet (
      id TEXT PRIMARY KEY,
      design_id TEXT NOT NULL REFERENCES design(id) ON DELETE CASCADE,
      sheet_index INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT 'Sheet 1',
      content TEXT NOT NULL,
      content_hash TEXT,
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
    footprintOptions: [
      {
        id: `fp-${code}`,
        variantId: "",
        label: "Default",
        isDefault: true,
        kicadPayload: { name: `${code}-footprint` },
        model3dOptions: [],
        densityLevel: null,
        ipcName: null,
      },
    ],
    defaultFootprintOptionId: `fp-${code}`,
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
      symbolData: {
        referencePrefix: "R",
        pinDefinitions: [],
        properties: { tolerance: "1%" },
      },
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

    const byMountType = await repo.listComponents({
      mountType: "through_hole",
    });
    expect(byMountType.length).toBe(1);
    expect(byMountType[0]!.component.canonicalKey).toBe("hdr-2x1");

    const byCategoryPath = await repo.listComponents({
      categoryPath: "passives/resistors",
    });
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
      defaultFootprintOptionId: "fp-1206-default",
    });
    expect(updatedVariant.humanLabel).toBe("1206 metric");
    expect(updatedVariant.defaultFootprintOptionId).toBe("fp-1206-default");

    const defaultVariant = await repo.variants.setDefaultVariant(
      created.component.id,
      newVariant.id,
    );
    expect(defaultVariant.id).toBe(newVariant.id);
    expect(defaultVariant.isDefault).toBe(true);

    const refreshed = await repo.getComponent(created.component.id);
    expect(refreshed!.component.defaultVariantId).toBe(newVariant.id);

    const oldDefault = refreshed!.variants.find(
      (item) => item.canonicalCode === "0805",
    )!;
    await repo.variants.removeVariant(oldDefault.id);

    const afterRemove = await repo.getComponent(created.component.id);
    expect(afterRemove!.variants.length).toBe(1);

    await expect(
      repo.variants.removeVariant(afterRemove!.variants[0]!.id),
    ).rejects.toThrow("Cannot remove the only variant");
  });

  test("getDeleteImpact returns usage count and design names", async () => {
    const created = await repo.createComponent({
      canonicalKey: "ferrite-bead",
      displayLabel: "Ferrite Bead",
      symbolData: { referencePrefix: "FB", pinDefinitions: [], properties: {} },
      variants: [variant("0603", "0603", true)],
    });

    sqlite.exec(`
      INSERT INTO design (id, workspace_id, name, created_at, updated_at, deleted_at)
      VALUES
        ('design-a', 'ws-1', 'Design A', 1, 1, NULL),
        ('design-b', 'ws-1', 'Design B', 1, 1, NULL);

      INSERT INTO design_sheet (id, design_id, sheet_index, title, content, content_hash, created_at, updated_at, deleted_at)
      VALUES
        ('sheet-a', 'design-a', 0, 'Sheet 1', '{"id":"doc-a","projectId":"p","updatedAt":"2026-01-01T00:00:00Z","version":1,"formatVersion":"pcb.schematic-project-document/v1","symbols":[{"id":"s1","libraryPartId":"${created.component.id}","reference":"U1","position":{"x":0,"y":0},"pins":[]}],"wires":[],"labels":[]}', 'h1', 1, 1, NULL),
        ('sheet-b', 'design-b', 0, 'Sheet 1', '{"id":"doc-b","projectId":"p","updatedAt":"2026-01-01T00:00:00Z","version":1,"formatVersion":"pcb.schematic-project-document/v1","symbols":[{"id":"s2","properties":{"component_id":"${created.component.id}"},"reference":"U2","position":{"x":0,"y":0},"pins":[]}],"wires":[],"labels":[]}', 'h2', 1, 1, NULL);
    `);

    const impact = await repo.getDeleteImpact(created.component.id);
    expect(impact.usageCount).toBe(2);
    expect(impact.designNames).toEqual(["Design A", "Design B"]);
  });

  test("deleteComponent ignores usage rows for missing or deleted designs", async () => {
    const created = await repo.createComponent({
      canonicalKey: "test-delete-unused",
      displayLabel: "Test Delete Unused",
      symbolData: { referencePrefix: "U", pinDefinitions: [], properties: {} },
      variants: [variant("0603", "0603", true)],
    });

    sqlite.exec(`
      INSERT INTO design (id, workspace_id, name, created_at, updated_at, deleted_at)
      VALUES ('deleted-design', 'ws-1', 'Deleted Design', 1, 1, 1);

      INSERT INTO design_sheet (id, design_id, sheet_index, title, content, content_hash, created_at, updated_at, deleted_at)
      VALUES
        ('sheet-deleted', 'deleted-design', 0, 'Sheet 1', '{"id":"doc-d","projectId":"p","updatedAt":"2026-01-01T00:00:00Z","version":1,"formatVersion":"pcb.schematic-project-document/v1","symbols":[{"id":"s3","libraryPartId":"${created.component.id}","reference":"U3","position":{"x":0,"y":0},"pins":[]}],"wires":[],"labels":[]}', 'h3', 1, 1, NULL);
    `);

    expect(await repo.getUsageCount(created.component.id)).toBe(0);

    await repo.deleteComponent(created.component.id);
    expect(await repo.getComponent(created.component.id)).toBeNull();
  });
});
