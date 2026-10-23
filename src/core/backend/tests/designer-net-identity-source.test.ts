import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { loadSchematicSource, loadSchematicProjection } from "../../../modules/designer/backend/projection-read";
import { readNetIdentityMigrationSource, legacyFillRowId } from "../../../modules/designer/backend/net-identity/migration-source";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import { insertPcbZone, migrateLegacyBoardFill, readPcbBoardSettingsForMigration } from "../../../modules/designer/backend/pcb/pcb-store";
import { designHeads, schematicParts, schematicPins, schematicWires, schematicLabels, schematicPrimitives, pcbEntities, netIdentityState } from "../../../modules/designer/backend/schema";
import type { PcbZone } from "../../../sdks/designer";
import { trace, via, freePad, freeHole, placement } from "./helpers/drc-fixtures";

const TS = "2026-01-01T00:00:00.000Z";
type DbClient = Parameters<typeof loadSchematicSource>[0];
type RawRow = Record<string, string | number | null>;
const databases: Database[] = [];

function makeDb(): { db: DbClient; sqlite: Database } {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  for (const table of [designHeads, schematicParts, schematicPins, schematicWires, schematicLabels, schematicPrimitives, pcbEntities, netIdentityState]) {
    const fields = Object.values(getTableColumns(table)).map((column) => `"${column.name}" ${column.getSQLType()}`);
    sqlite.exec(`CREATE TABLE "${getTableName(table)}" (${fields.join(", ")})`);
  }
  return { sqlite, db: drizzle(sqlite) as unknown as DbClient };
}
afterEach(() => { databases.splice(0).forEach((database) => database.close()); });

function rawRows(sqlite: Database): string {
  return JSON.stringify(sqlite.query("SELECT * FROM designer_pcb_entities ORDER BY id").all());
}
function seed(db: DbClient, kind: string, payload: unknown, rowId = kind): void {
  db.insert(pcbEntities).values({ id: rowId, designId: "d1", kind,
    payloadJson: JSON.stringify(payload), createdAt: TS, updatedAt: TS }).run();
}
function board(db: DbClient, extra: Record<string, unknown> = {}): void {
  seed(db, "board_settings", { ...createDefaultPcbBoardSettings(TS), ...extra });
}
function zone(id = "board:F.Cu"): PcbZone {
  return { id, name: null, enabled: true, lockedAt: null, layer: "F.Cu", netId: null,
    netName: "GND", region: { kind: "board" }, priority: 0, padConnection: "solid" };
}
function keepout(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "keepout", name: null, enabled: true, lockedAt: null, layers: ["F.Cu"],
    pointsMm: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    restrictions: { tracks: true, vias: true, pads: true, copperPour: true, footprints: true }, ...extra };
}
function insertRaw(sqlite: Database, table: AnySQLiteTable, rows: RawRow[]): void {
  const columns = getTableColumns(table);
  for (const row of rows) {
    const keys = Object.keys(row);
    sqlite.query(`INSERT INTO "${getTableName(table)}" (${keys.map((key) => `"${columns[key]!.name}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
      .run(...keys.map((key) => row[key]!));
  }
}

describe("read-only schematic source", () => {
  test("missing design returns null without creating state", () => {
    const { db, sqlite } = makeDb();
    expect(loadSchematicSource(db, "missing")).toBeNull();
    expect(sqlite.query("SELECT COUNT(*) AS count FROM designer_design_heads").get()).toEqual({ count: 0 });
    expect(rawRows(sqlite)).toBe("[]");
  });

  test("frozen raw rows map through the same order without attachment or derived fields", async () => {
    const { db, sqlite } = makeDb();
    const fixture = await Bun.file(new URL("./fixtures/legacy-net-ids/f3-name-hints.json", import.meta.url)).json() as {
      auxiliaryRows: { designHead: RawRow };
      payload: { designId: string; schematic: Record<string, RawRow[]> };
    };
    insertRaw(sqlite, designHeads, [fixture.auxiliaryRows.designHead]);
    for (const [key, table] of [["parts", schematicParts], ["pins", schematicPins], ["wires", schematicWires],
      ["labels", schematicLabels], ["primitives", schematicPrimitives]] as const) {
      insertRaw(sqlite, table, fixture.payload.schematic[key]!);
    }
    const source = loadSchematicSource(db, fixture.payload.designId)!;
    const projection = loadSchematicProjection(db, fixture.payload.designId)!;
    expect(source.parts).toEqual(projection.parts);
    expect(source.wires).toEqual(projection.wires);
    expect(source.labels).toEqual(projection.labels.map(({ attached: _attached, ...label }) => label));
    expect(source.primitives).toEqual(projection.primitives.map(({ attached: _attached, ...primitive }) => primitive));
    expect(source).not.toHaveProperty("nets");
    expect(source).not.toHaveProperty("junctions");
    expect(rawRows(sqlite)).toBe("[]");
  });
});

describe("read-only board and unsynced physical inputs", () => {
  test("absent board settings remain absent; persisted placements are not synchronized", () => {
    const { db, sqlite } = makeDb();
    seed(db, "placement", placement("orphaned-placement", { pads: [] }));
    const before = rawRows(sqlite);
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.board.status).toBe("absent");
    expect(result.placements.map((part) => part.id)).toEqual(["orphaned-placement"]);
    expect(result.allowPourEvidence).toBe(false);
    expect(result.trustedStackup).toBe(false);
    expect(rawRows(sqlite)).toBe(before);
  });

  test.each(["{ invalid JSON", JSON.stringify({ layerCount: 2, outline: { kind: "future" } })])("malformed board is recovered only in memory: %s", (payloadJson) => {
    const { db, sqlite } = makeDb();
    db.insert(pcbEntities).values({ id: "bad-board", designId: "d1", kind: "board_settings", payloadJson, createdAt: TS, updatedAt: TS }).run();
    const before = rawRows(sqlite);
    const result = readPcbBoardSettingsForMigration(db, "d1", TS);
    expect(result.status).toBe("unparseable");
    expect(result.rowId).toBe("bad-board");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(rawRows(sqlite)).toBe(before);
  });

  test("required-field failure still allows direct evidence only with an explicit trusted stackup", () => {
    const { db, sqlite } = makeDb();
    board(db, { outline: { kind: "future" } });
    seed(db, "trace", trace("trace", null, [[0, 0], [1, 0]]));
    const before = rawRows(sqlite);
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.board.status).toBe("unparseable");
    expect(result.trustedStackup).toBe(true);
    expect(result.evidence.traces).toHaveLength(1);
    expect(result.allowPourEvidence).toBe(false);
    expect(rawRows(sqlite)).toBe(before);
  });

  test("present invalid layerCount cannot admit repaired direct-contact geometry", () => {
    const { db } = makeDb();
    board(db, { layerCount: 3 });
    seed(db, "trace", trace("trace", null, [[0, 0], [1, 0]]));
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.board.status).toBe("parsed");
    expect(result.traces).toHaveLength(1);
    expect(result.evidence.traces).toEqual([]);
    expect(result.trustedStackup).toBe(false);
    expect(result.allowPourEvidence).toBe(false);
    expect(result.diagnostics.some((entry) => entry.path === "board_settings.layerCount")).toBe(true);
  });

  test("rule loss retains parsed settings and exact raw data while disabling pour evidence", () => {
    const { db, sqlite } = makeDb();
    board(db, { diffPairs: [{ id: "bad", pNetId: 3, nNetId: "b", futureKey: true }] });
    const before = rawRows(sqlite);
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.board.status).toBe("parsed");
    expect(result.board.diagnostics.length).toBeGreaterThan(0);
    expect(result.allowPourEvidence).toBe(false);
    expect(result.board.storedRaw).toMatchObject({ diffPairs: [{ futureKey: true }] });
    expect(rawRows(sqlite)).toBe(before);
  });

  test("filtered cutouts and polygon vertices disable pour without losing raw board geometry", () => {
    const { db, sqlite } = makeDb();
    const outline = { kind: "polygon", widthMm: 10, heightMm: 10, centerMm: { x: 0, y: 0 },
      pointsMm: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: "bad", y: 2 }, { x: 0, y: 10 }] };
    board(db, { outline, cutouts: [{ id: "hidden", shape: { kind: "future" } }] });
    seed(db, "trace", trace("trace", null, [[0, 0], [1, 0]]));
    const before = rawRows(sqlite);
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.board.status).toBe("parsed");
    expect(result.diagnostics.map((entry) => entry.path)).toContain("board_settings.outline.pointsMm");
    expect(result.diagnostics.map((entry) => entry.path)).toContain("board_settings.cutouts");
    expect(result.evidence.traces).toHaveLength(1);
    expect(result.allowPourEvidence).toBe(false);
    expect(rawRows(sqlite)).toBe(before);
  });

  test("valid parser inputs allow evidence; unknown extension keys and createdAt remain raw", () => {
    const { db, sqlite } = makeDb();
    board(db, { futureBoard: { keep: true } });
    seed(db, "trace", { ...trace("trace", null, [[0, 0], [1, 0]]), futureTrace: { keep: true } });
    seed(db, "via", via("via")); seed(db, "free_pad", freePad("pad"));
    seed(db, "free_hole", freeHole("hole", { x: 2, y: 2 }, 0.5));
    seed(db, "zone", zone()); seed(db, "keepout", keepout());
    const before = rawRows(sqlite);
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.diagnostics).toEqual([]);
    expect(result.allowPourEvidence).toBe(true);
    expect(result.evidence.traces).toHaveLength(1);
    expect(result.rawRows.find((row) => row.kind === "trace")?.payloadJson).toContain("futureTrace");
    expect(result.rawRows.every((row) => row.createdAt === TS)).toBe(true);
    expect(rawRows(sqlite)).toBe(before);
  });
});

describe("parser losses, normalizations, and ambiguous identities", () => {
  test("every dropped recognized row remains raw with exact parse-loss attribution", () => {
    const { db, sqlite } = makeDb(); board(db);
    seed(db, "trace", { ...trace("same", null, [[0, 0], [1, 0]]), widthMm: "bad" }, "rejected-trace");
    seed(db, "trace", trace("same", null, [[0, 0], [1, 0]]), "valid-trace");
    seed(db, "free_pad", { ...freePad("unknown-shape"), shape: "future" });
    seed(db, "zone", { id: "broken", layer: "F.Cu", region: { kind: "polygon", pointsMm: [] } });
    seed(db, "keepout", keepout({ layers: ["F.Cu", "F.Fab"] }));
    const before = rawRows(sqlite);
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.parseLosses.map((entry) => entry.rowId).sort()).toEqual(["free_pad", "keepout", "rejected-trace", "zone"]);
    expect(result.rawRows).toHaveLength(6);
    expect(result.traces).toHaveLength(1);
    expect(result.evidence.traces).toEqual([]);
    expect(result.allowPourEvidence).toBe(false);
    expect(rawRows(sqlite)).toBe(before);
  });

  test("present reader-coerced via fields and pad geometry never provide positive contact", () => {
    const { db } = makeDb(); board(db);
    seed(db, "via", { ...via("bad-via"), fromLayer: "Future.Cu", viaType: "future" }, "normalized-via");
    seed(db, "free_pad", { ...freePad("circle", { shape: "circle" }), heightMm: 2, layer: "Future.Cu" });
    seed(db, "keepout", keepout({ layers: ["F.Cu", "F.Cu"] }));
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.parseLosses).toEqual([]);
    expect(result.vias[0]).toMatchObject({ fromLayer: "F.Cu", viaType: "through" });
    expect(result.freePads[0]).toMatchObject({ heightMm: 1, layer: "F.Cu" });
    expect(result.evidence.vias).toEqual([]);
    expect(result.evidence.freePads).toEqual([]);
    expect(result.evidence.keepouts).toEqual([]);
    expect(result.allowPourEvidence).toBe(false);
    expect(result.diagnostics.some((entry) => entry.path === "via.viaType")).toBe(true);
  });

  test.each(["netId", "netName"] as const)("malformed declared %s cannot gain authority from a reader fallback", (field) => {
    const { db } = makeDb(); board(db);
    seed(db, "trace", { ...trace("trace", null, [[0, 0], [1, 0]]), netName: "GND", [field]: 3 });
    seed(db, "via", { ...via("via"), netName: "GND", [field]: 3 });
    seed(db, "free_pad", { ...freePad("pad"), [field]: 3 });
    seed(db, "zone", { ...zone(), [field]: 3 });
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    for (const kind of ["trace", "via", "free_pad", "zone"]) {
      expect(result.diagnostics.some((entry) => entry.kind === "normalization" && entry.path === `${kind}.${field}`)).toBe(true);
    }
    expect(result.evidence.traces).toEqual([]); expect(result.evidence.vias).toEqual([]);
    expect(result.evidence.freePads).toEqual([]); expect(result.evidence.zones).toEqual([]);
    expect(result.allowPourEvidence).toBe(false);
  });

  test.each([undefined, null, "  source name  "])("optional identity %s stays exact without normalization", (value) => {
    const { db } = makeDb(); board(db);
    seed(db, "trace", { ...trace("trace", null, [[0, 0], [1, 0]]), netId: value, netName: value });
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.diagnostics).toEqual([]);
    expect(result.evidence.traces[0]!.netId).toBe(value ?? null);
    expect(result.evidence.traces[0]!.netName).toBe(value);
    expect(result.allowPourEvidence).toBe(true);
  });

  test.each(["id", "partId"] as const)("ALL placements with duplicate %s are excluded from evidence", (field) => {
    const { db } = makeDb(); board(db);
    const first = placement("one", { pads: [] }), second = placement("two", { pads: [] });
    seed(db, "placement", first, "first");
    seed(db, "placement", { ...second, [field]: first[field] }, "second");
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.placements).toHaveLength(2);
    expect(result.evidence.placements).toEqual([]);
    expect(result.geometryAmbiguities).toHaveLength(2);
    expect(result.allowPourEvidence).toBe(false);
  });

  test("duplicate copper payload ids across kinds cannot be trusted", () => {
    const { db } = makeDb(); board(db);
    seed(db, "trace", trace("same", null, [[0, 0], [1, 0]])); seed(db, "via", via("same"));
    const result = readNetIdentityMigrationSource(db, "d1", TS);
    expect(result.geometryAmbiguities).toHaveLength(2);
    expect(result.evidence.traces).toEqual([]); expect(result.evidence.vias).toEqual([]);
    expect(result.allowPourEvidence).toBe(false);
  });
});

describe("deterministic legacy fill row ids", () => {
  function legacy(db: DbClient): void {
    const settings = createDefaultPcbBoardSettings(TS);
    board(db, { futureTop: { keep: true }, viewState: { ...settings.viewState,
      copperFillLayers: ["F.Cu", "B.Cu"], copperFillPourNetIds: {}, copperFillPadConnection: "solid", futureView: true } });
  }

  test("two raw copies migrate byte-identically, preserve unknown keys, and never call random ids", () => {
    const first = makeDb(), second = makeDb(); legacy(first.db); legacy(second.db);
    const options = { rowIdForZone: (zoneId: string) => legacyFillRowId("d1", zoneId) };
    expect(migrateLegacyBoardFill(first.db, "d1", new Map([["g", "GND"]]), TS, options)).toBe(true);
    expect(migrateLegacyBoardFill(second.db, "d1", new Map([["g", "GND"]]), TS, options)).toBe(true);
    expect(rawRows(first.sqlite)).toBe(rawRows(second.sqlite));
    const source = readNetIdentityMigrationSource(first.db, "d1", TS);
    expect(source.rawRows.filter((row) => row.kind === "zone").map((row) => row.id).sort()).toEqual([
      legacyFillRowId("d1", "board:F.Cu"), legacyFillRowId("d1", "board:B.Cu"),
    ].sort());
    expect(source.board.storedRaw).toMatchObject({ futureTop: { keep: true }, viewState: { futureView: true } });
    expect(migrateLegacyBoardFill(first.db, "d1", new Map(), TS, options)).toBe(false);
    expect(legacyFillRowId("d1", "board:F.Cu")).not.toBe(legacyFillRowId("d2", "board:F.Cu"));
    expect(legacyFillRowId("d1", "board:F.Cu")).not.toBe(legacyFillRowId("d1", "board:B.Cu"));
  });

  test("the default zone insertion path still allocates a fresh global UUID", () => {
    const { db, sqlite } = makeDb();
    insertPcbZone(db, "d1", zone(), TS); insertPcbZone(db, "d2", zone(), TS);
    const rows = sqlite.query<{ id: string }, []>("SELECT id FROM designer_pcb_entities ORDER BY id").all();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
    expect(rows.every((row) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(row.id))).toBe(true);
  });
});
