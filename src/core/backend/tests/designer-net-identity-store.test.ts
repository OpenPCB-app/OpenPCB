import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import {
  deleteDesignNetIdentity, readNetIdentityBackup, readNetIdentityQuarantine,
  readNetIdentityRetired, readNetIdentitySeqWatermark, readNetIdentityState,
  readRawNetIdentityState, writeNetIdentityBackup, writeNetIdentityQuarantine,
  writeNetIdentityRetired, writeNetIdentityState, type NetIdentityDb,
} from "../../../modules/designer/backend/net-identity/state-store";
import {
  designNetSalt, formatDurableNetId, isDurableNetId, isDurableNetIdOf,
  isLoneNetId, isPendingNetId, NetIdentityStateInvalidError, seqOf,
  type NetIdentityBackup, type NetIdentityQuarantineRecord,
  type NetIdentityRetiredRecord, type NetIdentityState, type NetNameSource,
} from "../../../modules/designer/backend/net-identity/types";
import {
  netIdentityBackups, netIdentityQuarantine, netIdentityRetired, netIdentityState,
} from "../../../modules/designer/backend/schema";
import { getSharedDb, getSharedSqlite } from "../db/sqlite-client";
import { bootDesignerRuntime } from "./helpers/designer-runtime";

const TS = "2026-10-22T12:00:00.000Z";
const migration = readFileSync(new URL("../../../modules/designer/backend/migrations/0022_net_identity.sql", import.meta.url), "utf8");

function fixture(): { db: NetIdentityDb; sqlite: Database } {
  const sqlite = new Database(":memory:");
  for (const statement of migration.split("--> statement-breakpoint")) sqlite.exec(statement);
  return { db: drizzle(sqlite) as unknown as NetIdentityDb, sqlite };
}

function net(designId: string, seq = 2): string {
  return formatDurableNetId(designNetSalt(designId), seq);
}

function state(designId = "design-a"): NetIdentityState {
  return {
    designId, schemaVersion: 1, status: "active", nextSeq: 10,
    active: [{ id: net(designId), name: "VCC", nameSource: "label", members: [{ kind: "pin", id: "part:pin" }] }],
    provenance: { origin: "native", createdAt: TS, migratorVersion: 1 },
    lastError: null, updatedAt: TS,
  };
}

function retired(designId = "design-a", seq = 4): NetIdentityRetiredRecord {
  return {
    designId, netId: net(designId, seq), seq, reason: "merged",
    successorIds: [net(designId), "nc:part:free-pin"], displayName: "Old VCC",
    retiredAtRevision: 5, createdAt: TS, updatedAt: TS,
  };
}

function quarantine(designId = "design-a"): NetIdentityQuarantineRecord {
  return {
    designId, refKind: "trace", refId: "trace-1", legacyValue: "pt:100:200",
    reason: "root_only", candidates: [net(designId), "nc:part:free-pin"],
    suggestedNetId: "nc:part:free-pin", createdAt: TS,
  };
}

function backup(designId = "design-a"): NetIdentityBackup {
  const payloadJson = ` {"format":"openpcb.net-identity-backup/2","designId":"${designId}",
    "revision":5,"schematic":{"pins":[{"id":"p:1","electricalIntent":"passive","future":7}]},
    "pcbEntities":[{"payloadJson":"{broken"}],"sessionHistories":[],"opaqueFuture":{"x":1}} `;
  return {
    designId, schemaVersion: 1, revision: 5, payloadJson,
    sha256: createHash("sha256").update(payloadJson).digest("hex"), createdAt: TS,
  };
}

function seedAll(db: NetIdentityDb, designId: string): void {
  writeNetIdentityState(db, state(designId));
  writeNetIdentityRetired(db, retired(designId));
  writeNetIdentityQuarantine(db, quarantine(designId));
  writeNetIdentityBackup(db, backup(designId));
}

function rows(db: NetIdentityDb): unknown[] {
  return [netIdentityState, netIdentityRetired, netIdentityQuarantine, netIdentityBackups]
    .map((table) => db.select().from(table).all());
}

describe("durable net id helpers", () => {
  test.each([
    ["abc", "xj4bnp4pah"], ["design-a", "w73dimg5wl"],
    ["design-b", "dd25ncdk4t"], ["π-design", "32voythakk"],
  ])("first 50 SHA-256 bits encode to lowercase base32: %s", (designId, expected) => {
    expect(designNetSalt(designId)).toBe(expected);
    expect(designNetSalt(designId)).toMatch(/^[a-z2-7]{10}$/);
  });

  test("durable ids enforce safe integer sequences and design salt", () => {
    const id = net("design-a", Number.MAX_SAFE_INTEGER);
    expect(seqOf(id)).toBe(Number.MAX_SAFE_INTEGER);
    expect(isDurableNetId(id)).toBe(true);
    expect(isDurableNetIdOf(id, "design-a")).toBe(true);
    expect(isDurableNetIdOf(id, "design-b")).toBe(false);
    for (const value of ["net:w73dimg5wl:0", "net:w73dimg5wl:01", "net:w73dimg5wl:-1", "net:W73DIMG5WL:1", "net:w73dimg5wl:1.5", "net:w73dimg5wl:9007199254740992", `${net("design-a")}\n`, "pt:1:2", "nc:p:1", "pending:1"]) {
      expect(isDurableNetId(value), value).toBe(false);
      expect(seqOf(value), value).toBeNull();
    }
    for (const seq of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatDurableNetId("w73dimg5wl", seq)).toThrow(NetIdentityStateInvalidError);
    }
    expect(() => formatDurableNetId("w73dimg5wl\n", 1)).toThrow(NetIdentityStateInvalidError);
    expect(() => designNetSalt("")).toThrow(NetIdentityStateInvalidError);
    expect(() => designNetSalt("   ")).toThrow(NetIdentityStateInvalidError);
  });

  test("lone and provisional helpers recognize only complete nonempty ids", () => {
    expect(isLoneNetId("nc:part:pin")).toBe(true);
    expect(isPendingNetId("pending:0")).toBe(true);
    for (const id of ["nc:", "nc:pin\n", "pending:1", "pin"]) expect(isLoneNetId(id)).toBe(false);
    for (const id of ["pending:", "pending:-1", "pending:1.2", "pending:1\n", "nc:pin"]) expect(isPendingNetId(id)).toBe(false);
  });
});

describe("net identity storage", () => {
  test("all four records round-trip without mutating reads or dropping opaque backup columns", () => {
    const { db } = fixture();
    seedAll(db, "design-a");
    const before = rows(db);
    expect(readNetIdentityState(db, "design-a")).toEqual(state());
    expect(readNetIdentityRetired(db, "design-a")).toEqual([retired()]);
    expect(readNetIdentityQuarantine(db, "design-a")).toEqual([quarantine()]);
    expect(readNetIdentityBackup(db, "design-a")).toEqual(backup());
    expect(readNetIdentityBackup(db, "design-a")!.payloadJson).toContain('"electricalIntent":"passive"');
    expect(readRawNetIdentityState(db, "design-a")!.activeJson).toBe(JSON.stringify(state().active));
    expect(rows(db)).toEqual(before);
    expect(readNetIdentityState(db, "missing")).toBeNull();
    expect(readRawNetIdentityState(db, "missing")).toBeNull();
    expect(readNetIdentitySeqWatermark(db, "missing")).toBe(1);
    expect(rows(db)).toEqual(before);
  });

  test.each(["auto", "override", "gnd", "pwr", "portal", "label"] as NetNameSource[])("naming provenance survives storage: %s", (nameSource) => {
    const { db } = fixture();
    const value = state();
    value.active[0]!.nameSource = nameSource;
    value.active[0]!.displayOverride = "Explicit user name";
    writeNetIdentityState(db, value);
    expect(readNetIdentityState(db, value.designId)).toEqual(value);
  });

  test("all state modes and migration provenance remain structural data", () => {
    const { db } = fixture();
    const value = state();
    value.active.push({ ...value.active[0]!, id: net(value.designId, 3), members: [{ kind: "wire", id: "part:pin" }] });
    value.provenance = {
      origin: "legacy-migration", createdAt: TS, migratorVersion: 1, restoredAt: TS,
      migration: {
        schemaVersion: 1, migratorVersion: 1, revisionBefore: 5, revisionAfter: 6,
        netsAllocated: 2, historiesArchived: 1, boardSettings: "unparseable",
        references: { total: 2, bound: { rootAndContact: 1, rootAndPour: 0, contact: 0, nameHint: 0, autoNameHint: 0 }, quarantined: { root_only: 1 } },
      },
    };
    for (const status of ["active", "migration_failed", "legacy_restored"] as const) {
      value.status = status;
      value.lastError = status === "migration_failed" ? "Evidence refused" : null;
      writeNetIdentityState(db, value);
      expect(readNetIdentityState(db, value.designId)).toEqual(value);
    }
  });

  test("contested stored membership is refused without rewriting evidence or allocation history", () => {
    const { db } = fixture();
    const value = state();
    writeNetIdentityState(db, value);
    const contested = [...value.active, { ...value.active[0]!, id: net(value.designId, 3) }];
    expect(() => writeNetIdentityState(db, { ...value, active: contested }))
      .toThrow("member belongs to multiple active records");
    db.update(netIdentityState).set({ activeJson: JSON.stringify(contested) })
      .where(eq(netIdentityState.designId, value.designId)).run();
    const before = rows(db);
    expect(() => readNetIdentityState(db, value.designId))
      .toThrow("member belongs to multiple active records");
    expect(() => readNetIdentitySeqWatermark(db, value.designId))
      .toThrow("member belongs to multiple active records");
    expect(rows(db)).toEqual(before);
  });

  test("watermark uses indexed retired maximum, active maximum and counter without rewriting corruption", () => {
    const { db, sqlite } = fixture();
    const value = state();
    value.active[0]!.id = net(value.designId, 20);
    value.nextSeq = 21;
    writeNetIdentityState(db, value);
    writeNetIdentityRetired(db, retired(value.designId, 40));
    writeNetIdentityRetired(db, retired("other-design", 900));
    db.update(netIdentityState).set({ nextSeq: 1 }).where(eq(netIdentityState.designId, value.designId)).run();
    const before = rows(db);
    expect(readNetIdentitySeqWatermark(db, value.designId)).toBe(41);
    expect(rows(db)).toEqual(before);
    db.delete(netIdentityRetired).where(eq(netIdentityRetired.designId, value.designId)).run();
    expect(readNetIdentitySeqWatermark(db, value.designId)).toBe(21);
    db.update(netIdentityState).set({ nextSeq: 50 }).where(eq(netIdentityState.designId, value.designId)).run();
    expect(readNetIdentitySeqWatermark(db, value.designId)).toBe(50);
    expect(sqlite.query("EXPLAIN QUERY PLAN SELECT MAX(seq) FROM designer_net_identity_retired WHERE design_id = ?").all(value.designId))
      .toEqual(expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining("designer_net_identity_retired_seq_idx") })]));
  });

  test("counter cannot decrease below ledger/current watermark, and overflow cannot allocate a reused id", () => {
    const { db } = fixture();
    writeNetIdentityState(db, state());
    writeNetIdentityRetired(db, retired("design-a", 40));
    const before = rows(db);
    expect(() => writeNetIdentityState(db, { ...state(), nextSeq: 10 })).toThrow(NetIdentityStateInvalidError);
    expect(rows(db)).toEqual(before);
    writeNetIdentityState(db, { ...state(), nextSeq: 41 });
    expect(readNetIdentitySeqWatermark(db, "design-a")).toBe(41);
    writeNetIdentityRetired(db, retired("design-a", Number.MAX_SAFE_INTEGER));
    const overflow = rows(db);
    expect(() => readNetIdentitySeqWatermark(db, "design-a")).toThrow(NetIdentityStateInvalidError);
    expect(rows(db)).toEqual(overflow);
  });

  for (const [field, value] of [
    ["schemaVersion", 2], ["status", "unknown"], ["nextSeq", 0], ["nextSeq", -1],
    ["nextSeq", 1.5], ["nextSeq", Number.MAX_SAFE_INTEGER + 1],
    ["activeJson", "{broken"], ["activeJson", "null"], ["provenanceJson", "[]"],
    ["provenanceJson", '{"origin":"future","createdAt":"x","migratorVersion":1}'],
  ] as const) {
    test(`corrupt raw ${field} is never absent or rewritten: ${value}`, () => {
      const { db } = fixture();
      writeNetIdentityState(db, state());
      db.update(netIdentityState).set({ [field]: value }).run();
      const before = rows(db);
      expect(() => readNetIdentityState(db, "design-a")).toThrow(NetIdentityStateInvalidError);
      expect(() => readNetIdentitySeqWatermark(db, "design-a")).toThrow(NetIdentityStateInvalidError);
      expect(readRawNetIdentityState(db, "design-a")).not.toBeNull();
      expect(rows(db)).toEqual(before);
    });
  }

  test.each([
    { id: net("other-design") }, { id: "nc:pin" }, { id: "pending:1" },
    { nameSource: "future" }, { nameSource: undefined },
    { members: [{ kind: "future", id: "p:1" }] },
    { members: [{ kind: "pin", id: "" }] }, { members: [] },
    { members: [{ kind: "pin", id: "   " }] },
    { members: [{ kind: "pin", id: "p:1" }, { kind: "pin", id: "p:1" }] },
  ])("invalid active id/source/member throws without mutation: %j", (patch) => {
    const { db } = fixture();
    const active = [{ ...state().active[0], ...patch }];
    writeNetIdentityState(db, state());
    db.update(netIdentityState).set({ activeJson: JSON.stringify(active) }).run();
    const before = rows(db);
    expect(() => readNetIdentityState(db, "design-a")).toThrow(NetIdentityStateInvalidError);
    expect(rows(db)).toEqual(before);
  });

  test("provenance references accept nc, reject pending, foreign and legacy ids", () => {
    const { db } = fixture();
    for (const id of ["pending:1", "pt:1:2", net("other-design")]) {
      expect(() => writeNetIdentityRetired(db, { ...retired(), successorIds: [id] })).toThrow(NetIdentityStateInvalidError);
      expect(() => writeNetIdentityQuarantine(db, { ...quarantine(), candidates: [id] })).toThrow(NetIdentityStateInvalidError);
      expect(() => writeNetIdentityQuarantine(db, { ...quarantine(), suggestedNetId: id })).toThrow(NetIdentityStateInvalidError);
    }
    expect(() => writeNetIdentityRetired(db, { ...retired(), seq: 8 })).toThrow(NetIdentityStateInvalidError);
    expect(rows(db)).toEqual([[], [], [], []]);
  });

  test("backup hashes and malformed ledger/quarantine JSON fail closed, preserving raw data", () => {
    const { db } = fixture();
    seedAll(db, "design-a");
    db.update(netIdentityBackups).set({ payloadJson: backup().payloadJson + " " }).run();
    db.update(netIdentityRetired).set({ successorIdsJson: "{broken" }).run();
    db.update(netIdentityQuarantine).set({ candidatesJson: "null" }).run();
    const before = rows(db);
    expect(() => readNetIdentityBackup(db, "design-a")).toThrow(NetIdentityStateInvalidError);
    expect(() => readNetIdentityRetired(db, "design-a")).toThrow(NetIdentityStateInvalidError);
    expect(() => readNetIdentityQuarantine(db, "design-a")).toThrow(NetIdentityStateInvalidError);
    expect(() => writeNetIdentityBackup(db, { ...backup("other"), sha256: "0".repeat(64) })).toThrow(NetIdentityStateInvalidError);
    expect(rows(db)).toEqual(before);
  });

  test("quarantine evidence cannot be overwritten; backup replacement is rollback-safe", () => {
    const { db } = fixture();
    seedAll(db, "design-a");
    const before = rows(db);
    expect(() => writeNetIdentityQuarantine(db, { ...quarantine(), reason: "conflict" })).toThrow();
    expect(rows(db)).toEqual(before);
    const replacement = backup();
    replacement.payloadJson += "\n";
    replacement.sha256 = createHash("sha256").update(replacement.payloadJson).digest("hex");
    replacement.revision = 6;
    expect(() => db.transaction((tx) => {
      writeNetIdentityBackup(tx as NetIdentityDb, replacement);
      expect(readNetIdentityBackup(tx as NetIdentityDb, "design-a")).toEqual(replacement);
      throw new Error("rollback backup replacement");
    })).toThrow("rollback backup replacement");
    expect(rows(db)).toEqual(before);
    writeNetIdentityBackup(db, replacement);
    expect(readNetIdentityBackup(db, "design-a")).toEqual(replacement);
  });

  test("caller transaction rolls back all identity writes and deletions", () => {
    const { db } = fixture();
    expect(() => db.transaction((tx) => {
      seedAll(tx as NetIdentityDb, "design-a");
      throw new Error("rollback identity writes");
    })).toThrow("rollback identity writes");
    expect(rows(db)).toEqual([[], [], [], []]);
    seedAll(db, "design-a");
    seedAll(db, "design-b");
    const before = rows(db);
    expect(() => db.transaction((tx) => {
      deleteDesignNetIdentity(tx as NetIdentityDb, "design-a");
      throw new Error("rollback identity delete");
    })).toThrow("rollback identity delete");
    expect(rows(db)).toEqual(before);
    deleteDesignNetIdentity(db, "design-a");
    expect(readNetIdentityState(db, "design-a")).toBeNull();
    expect(readNetIdentityState(db, "design-b")).toEqual(state("design-b"));
  });

  test("runtime boot initializes native designs; design delete is atomic", async () => {
    const { sdk, server } = await bootDesignerRuntime("net-identity-store");
    const sqlite = getSharedSqlite();
    const db = getSharedDb();
    const target = await sdk.createDesign({ name: "Delete identity" });
    const survivor = await sdk.createDesign({ name: "Keep identity" });
    await sdk.getSchematicProjection(target.id);
    await sdk.getPcbProjection(target.id);
    expect(readNetIdentityState(db, target.id)).toMatchObject({ status: "active", active: [], nextSeq: 1 });
    expect(readNetIdentityState(db, survivor.id)).toMatchObject({ status: "active", active: [], nextSeq: 1 });
    expect(rows(db).slice(1)).toEqual([[], [], []]);
    expect(sqlite.query<{ name: string }>("PRAGMA table_info(designer_schematic_pins)").all().some((column) => column.name === "electrical_intent")).toBe(true);
    seedAll(db, target.id);
    seedAll(db, survivor.id);
    const before = rows(db);
    sqlite.exec(`CREATE TRIGGER fail_identity_delete BEFORE DELETE ON designer_design_heads
      BEGIN SELECT RAISE(ABORT, 'identity delete failure'); END`);
    const deletion = () => server.fetch(new Request(
      `http://localhost/api/modules/designer/designs/${target.id}`, { method: "DELETE" },
    ));
    expect((await deletion()).status).toBe(500);
    expect(rows(db)).toEqual(before);
    sqlite.exec("DROP TRIGGER fail_identity_delete");
    expect((await deletion()).status).toBe(204);
    expect(readNetIdentityState(db, target.id)).toBeNull();
    expect(readNetIdentityRetired(db, target.id)).toEqual([]);
    expect(readNetIdentityQuarantine(db, target.id)).toEqual([]);
    expect(readNetIdentityBackup(db, target.id)).toBeNull();
    expect(readNetIdentityState(db, survivor.id)).toEqual(state(survivor.id));
  });
});
