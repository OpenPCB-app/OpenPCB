import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, sql } from "drizzle-orm";
import type { ModuleDbClient } from "../../contracts/modules/backend-module";
import { createDesignOperation } from "../../../modules/designer/backend/design-creation-receipts";
import { insertDesign } from "../../../modules/designer/backend/design-initialization";
import { checkNetDiagnostics } from "../../../modules/designer/backend/erc/projection-checks";
import { initializeNetIdentity, syncNetIdentity } from "../../../modules/designer/backend/net-identity/sync";
import { readNetIdentityState, type NetIdentityDb } from "../../../modules/designer/backend/net-identity/state-store";
import { loadSchematicProjection, loadSchematicSource } from "../../../modules/designer/backend/projection-read";
import { deriveNetsAndJunctions } from "../../../modules/designer/backend/projection-world";
import { designHeads, netIdentityState, pcbEntities, schematicLabels, schematicParts, schematicPins, schematicPrimitives, schematicWires } from "../../../modules/designer/backend/schema";

const DESIGN = "read-design", TS = "2026-10-22T12:00:00.000Z";
const migrationDir = new URL("../../../modules/designer/backend/migrations/", import.meta.url);

function database(): { db: NetIdentityDb; sqlite: Database } {
  const sqlite = new Database(":memory:");
  for (const name of readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(new URL(name, migrationDir), "utf8").split("--> statement-breakpoint")) sqlite.exec(statement);
  }
  return { db: drizzle(sqlite) as unknown as NetIdentityDb, sqlite };
}

function head(db: NetIdentityDb): void {
  db.insert(designHeads).values({ id: DESIGN, name: "Read design", revision: 3, createdAt: TS, updatedAt: TS }).run();
}

function schematic(db: NetIdentityDb): void {
  db.insert(schematicParts).values({ id: "part", designId: DESIGN, componentId: "component", reference: "U1", value: "", positionXNm: 0, positionYNm: 0, rotationDeg: 0, mirrored: 0, symbolSnapshotJson: "{}", footprintSnapshotJson: "{}", propertiesJson: "{}", createdAt: TS, updatedAt: TS }).run();
  for (const [index, id] of ["a", "b", "c"].entries()) db.insert(schematicPins).values({
    id, designId: DESIGN, partId: "part", originPinKey: id, number: String(index + 1), name: id,
    electricalType: "passive", unit: 1, localXNm: index * 10_000_000, localYNm: 0,
    worldXNm: index * 10_000_000, worldYNm: 0, createdAt: TS, updatedAt: TS,
  }).run();
}

function wire(db: NetIdentityDb): void {
  db.insert(schematicWires).values({ id: "wire", designId: DESIGN, sourcePinId: "a", targetPinId: "b", pointsJson: '[{"x":0,"y":0},{"x":10000000,"y":0}]', createdAt: TS, updatedAt: TS }).run();
}

function raw(sqlite: Database): string {
  return JSON.stringify(sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

function expectedLegacy(db: NetIdentityDb) {
  const source = loadSchematicSource(db, DESIGN)!;
  return deriveNetsAndJunctions(source.parts, source.wires, source.labels, source.primitives);
}

describe("durable schematic projection reads", () => {
  test("missing design returns null before consulting identity storage", () => {
    const { db, sqlite } = database();
    sqlite.exec("DROP TABLE designer_net_identity_state");
    expect(loadSchematicProjection(db, DESIGN)).toBeNull();
  });

  test("durable ids survive geometry/refdes changes; public naming metadata changes without writeback", () => {
    const { db, sqlite } = database();
    head(db); schematic(db); wire(db);
    initializeNetIdentity(db, DESIGN, "native", TS);
    const first = loadSchematicProjection(db, DESIGN)!;
    const durable = first.nets.find((net) => net.id.startsWith("net:"))!;
    expect(durable.autoNamed).toBe(true);
    db.update(schematicParts).set({ reference: "U9" }).run();
    db.update(schematicPins).set({ worldYNm: sql`${schematicPins.worldYNm} + 1000000` }).run();
    db.update(schematicWires).set({ pointsJson: '[{"x":0,"y":1000000},{"x":10000000,"y":1000000}]' }).run();
    const before = raw(sqlite);
    const moved = loadSchematicProjection(db, DESIGN)!;
    expect(moved.nets.find((net) => net.id === durable.id)).toEqual(durable);
    expect(moved.nets.find((net) => net.id === "nc:c")!.name).toBe("unconnected-(U9-3)");
    expect(raw(sqlite)).toBe(before);
    db.insert(schematicLabels).values({ id: "label", designId: DESIGN, text: "BUS", xNm: 0, yNm: 1_000_000, createdAt: TS, updatedAt: TS }).run();
    const afterLabel = raw(sqlite);
    expect(loadSchematicProjection(db, DESIGN)!.nets.find((net) => net.id === durable.id)).toMatchObject({ name: "BUS", autoNamed: false });
    expect(raw(sqlite)).toBe(afterLabel);
    expect(readNetIdentityState(db, DESIGN)!.active[0]!.name).toBe(durable.name);
  });

  test("exact fast path reads neither PCB rows nor retirement ledger", () => {
    const { db, sqlite } = database();
    head(db); schematic(db); wire(db);
    initializeNetIdentity(db, DESIGN, "native", TS);
    sqlite.exec("DROP TABLE designer_pcb_entities");
    sqlite.exec("DROP TABLE designer_net_identity_retired");
    const before = raw(sqlite);
    expect(loadSchematicProjection(db, DESIGN)!.nets.some((net) => net.id.startsWith("net:"))).toBe(true);
    expect(raw(sqlite)).toBe(before);
  });

  test("new non-lone component remains provisional only inside an unsynced transaction; no identity allocation", () => {
    const { db, sqlite } = database();
    insertDesign(db, { name: "Pending" }, DESIGN, TS);
    const stateBefore = readNetIdentityState(db, DESIGN);
    const before = raw(sqlite);
    expect(() => db.transaction((txRaw) => {
      const tx = txRaw as NetIdentityDb;
      schematic(tx); wire(tx);
      const graphBefore = raw(sqlite);
      const projection = loadSchematicProjection(tx, DESIGN)!;
      expect(projection.nets.map((net) => net.id)).toEqual(["nc:c", "pending:0"]);
      expect(readNetIdentityState(tx, DESIGN)).toEqual(stateBefore);
      expect(raw(sqlite)).toBe(graphBefore);
      syncNetIdentity(tx, DESIGN, 1, TS);
      expect(loadSchematicProjection(tx, DESIGN)!.nets.every((net) => !net.id.startsWith("pending:"))).toBe(true);
      throw new Error("rollback test transaction");
    })).toThrow("rollback test transaction");
    expect(raw(sqlite)).toBe(before);
  });

  test("durable naming diagnostics anchor only bound ids while legacy warning bytes stay unchanged", () => {
    const { db, sqlite } = database();
    head(db); schematic(db); wire(db);
    for (const [id, kind, payloadJson] of [["gnd", "gnd", "{}"], ["pwr", "pwr", '{"railText":"VCC"}']] as const) {
      db.insert(schematicPrimitives).values({ id, designId: DESIGN, kind, positionXNm: 0, positionYNm: 0, rotationDeg: 0, payloadJson, createdAt: TS, updatedAt: TS }).run();
    }
    db.insert(schematicLabels).values({ id: "label", designId: DESIGN, text: "SIGNAL", xNm: 0, yNm: 0, createdAt: TS, updatedAt: TS }).run();
    const warnings = JSON.stringify(expectedLegacy(db).warnings);
    initializeNetIdentity(db, DESIGN, "native", TS);
    const before = raw(sqlite);
    const projection = loadSchematicProjection(db, DESIGN)!;
    const rows = checkNetDiagnostics(projection);
    expect(rows).toHaveLength(2);
    for (const row of rows) for (const anchor of row.anchors) {
      expect(anchor.kind === "net" && projection.nets.some((net) => net.id === anchor.netId)).toBe(true);
    }
    expect(JSON.stringify(expectedLegacy(db).warnings)).toBe(warnings);
    expect(raw(sqlite)).toBe(before);
  });

  test.each(["absent", "migration_failed", "corrupt"])("%s identity mode preserves exact legacy derivation without writes", (mode) => {
    const { db, sqlite } = database();
    head(db); schematic(db); wire(db);
    if (mode !== "absent") {
      initializeNetIdentity(db, DESIGN, "native", TS);
      if (mode === "migration_failed") db.update(netIdentityState).set({ status: "migration_failed", activeJson: "[]", lastError: "migration failed" }).run();
      else db.update(netIdentityState).set({ activeJson: "{broken" }).run();
    }
    const legacy = expectedLegacy(db);
    const before = raw(sqlite);
    const projection = loadSchematicProjection(db, DESIGN)!;
    expect(projection.nets).toEqual(legacy.nets);
    expect(projection.netDiagnostics).toEqual(legacy.warnings);
    expect(raw(sqlite)).toBe(before);
  });
});

describe("common design initialization", () => {
  test("ordinary and receipted creation initialize empty native state at revision zero", () => {
    const { db } = database();
    expect(insertDesign(db, { name: "Ordinary" }, DESIGN, TS).revision).toBe(0);
    expect(readNetIdentityState(db, DESIGN)).toMatchObject({ status: "active", active: [], nextSeq: 1, provenance: { origin: "native" } });
    expect(db.select().from(pcbEntities).all()).toHaveLength(1);
    const moduleDb: ModuleDbClient = {
      moduleId: "designer", tablePrefix: "designer_", db, rawSql: () => [],
      transaction: (callback) => db.transaction((tx) => callback(tx)),
    };
    const result = createDesignOperation(moduleDb, { name: "Receipted" }, {
      actorScope: "actor", operationId: "operation", actionId: "action", toolName: "create_design",
      argumentFingerprint: "fingerprint", designId: "receipt-design", expectedRevision: 0,
    });
    expect(result.ok).toBe(true);
    expect(readNetIdentityState(db, "receipt-design")).toMatchObject({ status: "active", active: [], nextSeq: 1, provenance: { origin: "native" } });
    expect(db.select().from(designHeads).where(eq(designHeads.id, "receipt-design")).get()!.revision).toBe(0);
  });
});
