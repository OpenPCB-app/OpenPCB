import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { buildUserLibraryPack } from "../../../modules/library/backend/cloud-pack-builder";
import { readOpclibFromBytes } from "../../../modules/library/backend/sync/opclib-reader";

type Db = BetterSQLite3Database<Record<string, unknown>>;

// Minimal table set the pack-builder reads (all declared columns must exist
// because Drizzle's select names every column).
const SCHEMA = `
  create table library_symbols (
    id text primary key, name text not null, data_json text not null,
    created_at text not null, source_id text, version text, uuid text,
    content_sha256 text
  );
  create table library_footprints (
    id text primary key, name text not null, data_json text not null,
    created_at text not null, source_id text, version text, uuid text,
    content_sha256 text
  );
  create table library_footprint_models (
    footprint_id text primary key, status text not null, glb_path text,
    glb_sha256 text, source_step_path text, source_step_sha256 text,
    source_filename text, source_byte_size integer, model_ref_json text,
    tessellation_params_json text, converter_version text, byte_size integer,
    error_message text, created_at text not null, updated_at text not null
  );
  create table library_components (
    id text primary key, name text not null, description text not null,
    symbol_id text not null, footprint_id text not null, tags_json text not null,
    created_at text not null, is_builtin integer not null default 0,
    source_id text, version text, uuid text, content_sha256 text,
    origin_json text, manufacturer text, manufacturer_part_number text,
    lcsc_part_number text, supplier text
  );
  create table library_component_footprints (
    component_id text not null, footprint_id text not null,
    is_default integer not null default 0, variant_label text not null,
    sort_order integer not null default 0, pinmap_json text,
    primary key (component_id, footprint_id)
  );
`;

function seedCustomComponent(sqlite: Database): void {
  const now = "2026-01-01T00:00:00.000Z";
  sqlite.run(
    `insert into library_symbols (id,name,data_json,created_at) values (?,?,?,?)`,
    ["sym.custom.r", "R", '{"pins":[]}', now],
  );
  sqlite.run(
    `insert into library_footprints (id,name,data_json,created_at) values (?,?,?,?)`,
    ["fp.custom.0402", "0402", '{"pads":[]}', now],
  );
  sqlite.run(
    `insert into library_components
       (id,name,description,symbol_id,footprint_id,tags_json,created_at,is_builtin,manufacturer,manufacturer_part_number)
     values (?,?,?,?,?,?,?,?,?,?)`,
    [
      "comp.custom.r1k",
      "1k Resistor",
      "A custom 1k resistor",
      "sym.custom.r",
      "fp.custom.0402",
      '["passive","resistor"]',
      now,
      0,
      "Yageo",
      "RC0402FR-071KL",
    ],
  );
  sqlite.run(
    `insert into library_component_footprints
       (component_id,footprint_id,is_default,variant_label,sort_order,pinmap_json)
     values (?,?,?,?,?,?)`,
    [
      "comp.custom.r1k",
      "fp.custom.0402",
      1,
      "0402",
      0,
      '[{"pinNumber":"1","padNumber":"1","pinName":"~"},{"pinNumber":"2","padNumber":"2","pinName":"~"}]',
    ],
  );
}

describe("buildUserLibraryPack", () => {
  let ctx: { db: Db; close: () => void };
  let sqlite: Database;
  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(SCHEMA);
    ctx = { db: drizzle(sqlite) as unknown as Db, close: () => sqlite.close() };
  });
  afterEach(() => ctx.close());

  test("returns null when there are no custom components", async () => {
    const out = await buildUserLibraryPack(ctx.db, "2026-01-01T00:00:00.000Z");
    expect(out).toBeNull();
  });

  test("packs a custom component and round-trips through unpack", async () => {
    seedCustomComponent(sqlite);
    const out = await buildUserLibraryPack(ctx.db, "2026-01-01T00:00:00.000Z");
    expect(out).not.toBeNull();
    expect(out!.componentCount).toBe(1);

    const m = out!.result.manifest;
    expect(m.library.kind).toBe("user");
    expect(m.components).toHaveLength(1);
    expect(m.symbols).toHaveLength(1);
    expect(m.footprints).toHaveLength(1);

    const comp = m.components[0]!;
    // Local ids are mapped to schema-valid namespaced opclib ids; references
    // must stay consistent within the manifest.
    expect(comp.id).toMatch(/^user\.custom\.component\.[0-9a-f]{16}$/);
    expect(comp.symbol).toBe(m.symbols[0]!.id);
    expect(comp.defaultFootprint).toBe(m.footprints[0]!.id);
    expect(comp.footprints[0]!.footprint).toBe(m.footprints[0]!.id);
    expect(comp.footprints[0]!.pinMap).toHaveLength(2);
    expect(comp.manufacturerParts?.[0]).toEqual({
      manufacturer: "Yageo",
      mpn: "RC0402FR-071KL",
    });
    // Derived UUID must satisfy the opclib schema pattern.
    expect(comp.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Unpack the produced archive — proves it's a valid, readable .opclib.
    const pkg = readOpclibFromBytes(out!.result.bytes);
    expect(pkg.manifest.components).toHaveLength(1);
    expect(pkg.manifest.components[0]!.id).toBe(comp.id);
  });

  test("excludes built-in components", async () => {
    seedCustomComponent(sqlite);
    sqlite.run(
      `insert into library_components
         (id,name,description,symbol_id,footprint_id,tags_json,created_at,is_builtin)
       values (?,?,?,?,?,?,?,?)`,
      [
        "comp.builtin.x",
        "Builtin",
        "",
        "sym.custom.r",
        "fp.custom.0402",
        "[]",
        "2026-01-01T00:00:00.000Z",
        1,
      ],
    );
    const out = await buildUserLibraryPack(ctx.db, "2026-01-01T00:00:00.000Z");
    expect(out!.componentCount).toBe(1);
    expect(out!.result.manifest.components[0]!.name).toBe("1k Resistor");
  });
});
