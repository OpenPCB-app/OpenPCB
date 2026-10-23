import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import {
  captureNetIdentityBackup, parseNetIdentityBackup, type NetIdentityBackupSnapshot,
} from "../../../modules/designer/backend/net-identity/backup";
import { restoreLegacyNetIdentity } from "../../../modules/designer/backend/net-identity/restore";
import {
  readNetIdentityBackup, readNetIdentityQuarantine, readNetIdentityRetired,
  readNetIdentitySeqWatermark, readNetIdentityState, writeNetIdentityBackup,
  writeNetIdentityQuarantine, writeNetIdentityRetired, writeNetIdentityState,
  type NetIdentityDb,
} from "../../../modules/designer/backend/net-identity/state-store";
import {
  designNetSalt, formatDurableNetId, NetIdentityStateInvalidError,
  type NetIdentityBackup, type NetIdentityState,
} from "../../../modules/designer/backend/net-identity/types";
import {
  bomOverrides, captureSessions, commandLog, commentThreads, designHeads, netIdentityBackups, netIdentityState,
  pcbEntities, schematicLabels, schematicParts, schematicPins, schematicPrimitives,
  schematicWires, sessionHistories,
} from "../../../modules/designer/backend/schema";
import { AppError } from "../../contracts/errors";

const TS = "2026-10-22T20:00:00.000Z";
const FIXTURES = ["f1-routed-clean", "f2-t132-stale", "f3-name-hints", "f9-pour-only-gnd"];
const migrationsDir = new URL("../../../modules/designer/backend/migrations/", import.meta.url);

interface FrozenFixture {
  sha256: string;
  payload: NetIdentityBackupSnapshot;
  auxiliaryRows: {
    designHead: typeof designHeads.$inferSelect;
    commandLog: (typeof commandLog.$inferSelect)[];
  };
}

function frozen(name = FIXTURES[0]!): FrozenFixture {
  return JSON.parse(readFileSync(new URL(`./fixtures/legacy-net-ids/${name}.json`, import.meta.url), "utf8")) as FrozenFixture;
}

function database(): { db: NetIdentityDb; sqlite: Database } {
  const sqlite = new Database(":memory:");
  for (const name of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(name, migrationsDir), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) sqlite.exec(statement);
  }
  return { db: drizzle(sqlite) as unknown as NetIdentityDb, sqlite };
}

function hydrate(db: NetIdentityDb, input: FrozenFixture): void {
  const snapshot = input.payload;
  db.insert(designHeads).values(input.auxiliaryRows.designHead).run();
  for (const row of snapshot.schematic.parts) db.insert(schematicParts).values(row).run();
  for (const row of snapshot.schematic.pins) db.insert(schematicPins).values(row).run();
  for (const row of snapshot.schematic.wires) db.insert(schematicWires).values(row).run();
  for (const row of snapshot.schematic.labels) db.insert(schematicLabels).values(row).run();
  for (const row of snapshot.schematic.primitives) db.insert(schematicPrimitives).values(row).run();
  for (const row of snapshot.pcbEntities) db.insert(pcbEntities).values(row).run();
  for (const row of snapshot.sessionHistories) db.insert(sessionHistories).values(row).run();
  for (const row of input.auxiliaryRows.commandLog) db.insert(commandLog).values(row).run();
}

function id(designId: string, seq: number): string {
  return formatDurableNetId(designNetSalt(designId), seq);
}

function migratedState(snapshot: NetIdentityBackupSnapshot): NetIdentityState {
  const designId = snapshot.designId;
  return {
    designId, schemaVersion: 1, status: "active", nextSeq: 100,
    active: [{ id: id(designId, 2), name: "VCC", nameSource: "label", members: [{ kind: "pin", id: snapshot.schematic.pins[0]!.id }] }],
    provenance: {
      origin: "legacy-migration", createdAt: TS, migratorVersion: 1,
      migration: {
        schemaVersion: 1, migratorVersion: 1, revisionBefore: snapshot.revision,
        revisionAfter: snapshot.revision + 1, netsAllocated: 1, historiesArchived: snapshot.sessionHistories.length,
        references: { total: 0, bound: { rootAndContact: 0, rootAndPour: 0, contact: 0, nameHint: 0, autoNameHint: 0 }, quarantined: {} },
        boardSettings: "migrated",
      },
    },
    lastError: null, updatedAt: TS,
  };
}

function ready(name?: string) {
  const { db, sqlite } = database();
  const input = frozen(name);
  hydrate(db, input);
  const backup = captureNetIdentityBackup(db, input.payload.designId, TS);
  writeNetIdentityBackup(db, backup);
  writeNetIdentityState(db, migratedState(input.payload));
  db.update(designHeads).set({ revision: input.payload.revision + 1 }).run();
  return { db, sqlite, input, backup, designId: input.payload.designId };
}

function allRows(sqlite: Database): string {
  const tables = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => ({ name, rows: sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() })));
}

function altered(backup: NetIdentityBackup, mutate: (payload: NetIdentityBackupSnapshot) => void): NetIdentityBackup {
  const payload = JSON.parse(backup.payloadJson) as NetIdentityBackupSnapshot;
  mutate(payload);
  const payloadJson = JSON.stringify(payload);
  return { ...backup, payloadJson, sha256: createHash("sha256").update(payloadJson).digest("hex") };
}

describe("net identity logical backup", () => {
  test.each(FIXTURES)("capture matches frozen %s bytes/hash without writes", (name) => {
    const { db, sqlite } = database();
    const input = frozen(name);
    hydrate(db, input);
    const before = allRows(sqlite);
    const backup = captureNetIdentityBackup(db, input.payload.designId, TS);
    expect(backup.payloadJson).toBe(JSON.stringify(input.payload));
    expect(backup.sha256).toBe(input.sha256);
    expect(parseNetIdentityBackup(backup, input.payload.designId)).toEqual(input.payload);
    expect(allRows(sqlite)).toBe(before);
    expect(readNetIdentityBackup(db, input.payload.designId)).toBeNull();
  });

  test("known and unknown electrical intents and malformed raw JSON remain opaque", () => {
    for (const electricalIntent of ["power_source", "future_intent:v7"] as const) {
      const { db } = database();
      const input = frozen();
      hydrate(db, input);
      const designId = input.payload.designId;
      const first = input.payload.schematic.pins[0]!;
      db.update(schematicPins).set({ electricalIntent }).where(eq(schematicPins.id, first.id)).run();
      db.update(schematicParts).set({ propertiesJson: " {unreadable-future " }).where(eq(schematicParts.designId, designId)).run();
      const backup = captureNetIdentityBackup(db, designId, TS);
      const payload = parseNetIdentityBackup(backup, designId);
      expect(payload.schematic.pins.find((row) => row.id === first.id)!.electricalIntent).toBe(electricalIntent);
      expect(payload.schematic.parts.every((row) => row.propertiesJson === " {unreadable-future ")).toBe(true);
      writeNetIdentityBackup(db, backup);
      writeNetIdentityState(db, migratedState(payload));
      db.update(designHeads).set({ revision: payload.revision + 1 }).run();
      db.update(schematicPins).set({ electricalIntent: "later-edit" }).run();
      restoreLegacyNetIdentity(db, designId, { timestamp: TS, confirmDiscardRevisions: false });
      expect(db.select().from(schematicPins).where(eq(schematicPins.id, first.id)).get()!.electricalIntent).toBe(electricalIntent);
    }
  });

  test("missing design refuses capture without creating rows", () => {
    const { db, sqlite } = database();
    const before = allRows(sqlite);
    expect(() => captureNetIdentityBackup(db, "missing", TS)).toThrow(NetIdentityStateInvalidError);
    expect(allRows(sqlite)).toBe(before);
  });
});

describe("legacy net identity restore", () => {
  test.each(FIXTURES)("restore %s returns exact raw tables/history while retaining lifetime identity watermark", (name) => {
    const { db, sqlite, input, backup, designId } = ready(name);
    db.insert(designHeads).values({ id: "other-design", name: "Keep", revision: 2, createdAt: TS, updatedAt: TS }).run();
    db.insert(bomOverrides).values({ id: "bom-keep", designId, refdes: "C1", notes: "Keep BOM", createdAt: TS, updatedAt: TS }).run();
    db.insert(commentThreads).values({ id: "comment-keep", designId, surface: "schematic", createdAt: TS, updatedAt: TS }).run();
    db.insert(captureSessions).values({ sessionUlid: "capture-keep", designId, startedAt: TS, logDir: "/tmp/fixture-capture" }).run();
    db.insert(pcbEntities).values({ id: "other-copper", designId: "other-design", kind: "trace", payloadJson: "{future", createdAt: TS, updatedAt: TS }).run();
    writeNetIdentityRetired(db, { designId, netId: id(designId, 120), seq: 120, reason: "removed", successorIds: [], displayName: "Old", retiredAtRevision: input.payload.revision + 1, createdAt: TS, updatedAt: TS });
    writeNetIdentityQuarantine(db, { designId, refKind: "trace", refId: "migration-trace", legacyValue: "pt:1:2", reason: "root_only", candidates: [], suggestedNetId: null, createdAt: TS });
    const commandRows = db.select().from(commandLog).all();
    const commentRows = db.select().from(commentThreads).all();
    const captureRows = db.select().from(captureSessions).all();
    const unrelated = db.select().from(pcbEntities).where(eq(pcbEntities.designId, "other-design")).all();
    db.update(schematicParts).set({ value: "Post-migration" }).where(eq(schematicParts.designId, designId)).run();
    db.update(schematicPins).set({ electricalIntent: "future_intent:v8" }).where(eq(schematicPins.designId, designId)).run();
    db.delete(schematicWires).where(eq(schematicWires.designId, designId)).run();
    db.delete(sessionHistories).where(eq(sessionHistories.designId, designId)).run();
    db.update(pcbEntities).set({ payloadJson: "{new future payload" }).where(eq(pcbEntities.designId, designId)).run();
    db.insert(schematicLabels).values({ id: "later-label", designId, text: "later", xNm: 0, yNm: 0, createdAt: TS, updatedAt: TS }).run();
    db.insert(sessionHistories).values({ id: "later-history", designId, sessionId: "later-session", undoStackJson: "future", redoStackJson: "future", updatedAt: TS }).run();
    db.update(designHeads).set({ revision: input.payload.revision + 5 }).where(eq(designHeads.id, designId)).run();
    const before = allRows(sqlite);
    try {
      restoreLegacyNetIdentity(db, designId, { timestamp: TS, confirmDiscardRevisions: false });
      throw new Error("Expected restore confirmation refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(409);
      expect((error as AppError).type).toBe("https://openpcb.dev/problems/net-identity-restore-discards-edits");
    }
    expect(allRows(sqlite)).toBe(before);
    expect(restoreLegacyNetIdentity(db, designId, { timestamp: TS, confirmDiscardRevisions: true }))
      .toEqual({ revision: input.payload.revision + 6 });
    const restored = parseNetIdentityBackup(captureNetIdentityBackup(db, designId, TS), designId);
    expect(JSON.stringify({ ...restored, revision: input.payload.revision })).toBe(backup.payloadJson);
    expect(readNetIdentityState(db, designId)).toEqual({
      ...migratedState(input.payload), status: "legacy_restored", active: [], nextSeq: 121,
      provenance: { ...migratedState(input.payload).provenance, restoredAt: TS },
    });
    expect(readNetIdentitySeqWatermark(db, designId)).toBe(121);
    expect(readNetIdentityRetired(db, designId).map((row) => [row.seq, row.reason, row.successorIds])).toEqual([[2, "history", []], [120, "removed", []]]);
    expect(readNetIdentityQuarantine(db, designId)).toEqual([]);
    expect(readNetIdentityBackup(db, designId)).toEqual(backup);
    expect(db.select().from(commandLog).all()).toEqual(commandRows);
    expect(db.select().from(commentThreads).all()).toEqual(commentRows);
    expect(db.select().from(captureSessions).all()).toEqual(captureRows);
    expect(db.select().from(bomOverrides).all()[0]!.notes).toBe("Keep BOM");
    expect(db.select().from(pcbEntities).where(eq(pcbEntities.designId, "other-design")).all()).toEqual(unrelated);
  });

  test("no later edits needs no confirmation; restoring twice refuses", () => {
    const { db, sqlite, designId, input } = ready();
    expect(restoreLegacyNetIdentity(db, designId, { timestamp: TS, confirmDiscardRevisions: false }).revision).toBe(input.payload.revision + 2);
    const before = allRows(sqlite);
    expect(() => restoreLegacyNetIdentity(db, designId, { timestamp: TS, confirmDiscardRevisions: true })).toThrow(NetIdentityStateInvalidError);
    expect(allRows(sqlite)).toBe(before);
  });

  test.each([
    ["foreign payload design", (p: NetIdentityBackupSnapshot) => { p.designId = "foreign"; }],
    ["foreign row", (p: NetIdentityBackupSnapshot) => { p.schematic.pins[0]!.designId = "foreign"; }],
    ["duplicate row", (p: NetIdentityBackupSnapshot) => { p.schematic.pins.push(p.schematic.pins[0]!); }],
    ["missing newer column", (p: NetIdentityBackupSnapshot) => { delete (p.schematic.pins[0] as Partial<typeof p.schematic.pins[number]>)!.electricalIntent; }],
    ["malformed required column", (p: NetIdentityBackupSnapshot) => { (p.schematic.pins[0] as unknown as Record<string, unknown>).worldXNm = "wrong"; }],
    ["unsupported format", (p: NetIdentityBackupSnapshot) => { (p as unknown as Record<string, unknown>).format = "openpcb.net-identity-backup/99"; }],
    ["missing table", (p: NetIdentityBackupSnapshot) => { delete (p.schematic as Partial<typeof p.schematic>).labels; }],
    ["missing owning part", (p: NetIdentityBackupSnapshot) => { p.schematic.pins[0]!.partId = "foreign-part"; }],
  ] as const)("%s refuses before mutation", (_label, mutate) => {
    const { db, sqlite, backup, designId } = ready();
    const changed = altered(backup, mutate);
    writeNetIdentityBackup(db, changed);
    const before = allRows(sqlite);
    expect(() => restoreLegacyNetIdentity(db, designId, { timestamp: TS, confirmDiscardRevisions: true })).toThrow(NetIdentityStateInvalidError);
    expect(allRows(sqlite)).toBe(before);
  });

  test("checksum mismatch, missing backup, missing state/head and overflow refuse without mutation", () => {
    for (const scenario of ["checksum", "backup", "state", "head", "overflow"] as const) {
      const { db, sqlite, designId } = ready();
      if (scenario === "checksum") db.update(netIdentityBackups).set({ sha256: "0".repeat(64) }).run();
      if (scenario === "backup") db.delete(netIdentityBackups).run();
      if (scenario === "state") db.delete(netIdentityState).run();
      if (scenario === "head") db.delete(designHeads).run();
      if (scenario === "overflow") db.update(designHeads).set({ revision: Number.MAX_SAFE_INTEGER }).run();
      const before = allRows(sqlite);
      expect(() => restoreLegacyNetIdentity(db, designId, { timestamp: TS, confirmDiscardRevisions: true })).toThrow(NetIdentityStateInvalidError);
      expect(allRows(sqlite)).toBe(before);
    }
  });

  test("id now owned by another design is rejected before deletes", () => {
    const { db, sqlite, designId, input } = ready();
    const row = input.payload.pcbEntities[0]!;
    db.update(pcbEntities).set({ designId: "other-design" }).where(eq(pcbEntities.id, row.id)).run();
    const before = allRows(sqlite);
    expect(() => restoreLegacyNetIdentity(db, designId, { timestamp: TS, confirmDiscardRevisions: true })).toThrow(NetIdentityStateInvalidError);
    expect(allRows(sqlite)).toBe(before);
  });

  test.each(["replacement", "state", "head"])("failure during %s rolls back all restored rows and identity changes", (stage) => {
    const { db, sqlite, designId } = ready();
    db.update(schematicParts).set({ value: "Keep later data" }).run();
    const table = stage === "replacement" ? "designer_pcb_entities" : stage === "state" ? "designer_net_identity_state" : "designer_design_heads";
    const operation = stage === "replacement" ? "INSERT" : "UPDATE";
    sqlite.exec(`CREATE TRIGGER fail_restore BEFORE ${operation} ON ${table}
      BEGIN SELECT RAISE(ABORT, 'restore fault'); END`);
    const before = allRows(sqlite);
    expect(() => restoreLegacyNetIdentity(db, designId, { timestamp: TS, confirmDiscardRevisions: true })).toThrow("restore fault");
    expect(allRows(sqlite)).toBe(before);
    expect(readNetIdentityState(db, designId)!.status).toBe("active");
    expect(readNetIdentityRetired(db, designId)).toEqual([]);
  });
});
