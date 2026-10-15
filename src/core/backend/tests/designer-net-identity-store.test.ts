/**
 * H08 S3 (OPENPCB-56 §3.2): the net-identity tables, their single writer and
 * the durable id format. Runs against the real migrated schema of a booted
 * runtime, so the migration-on-boot and delete-cascade cases cover the DDL and
 * `deleteDesign` exactly as shipped.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  NetIdentityStateError,
  type NetIdentityStateErrorReason,
  deleteNetIdentityState,
  deleteQuarantineRecords,
  deleteRetiredNets,
  insertNetIdentityState,
  insertQuarantineRecords,
  listQuarantineRecords,
  listRetiredNets,
  readNetIdentityBackup,
  readNetIdentityState,
  readRetiredNet,
  readSeqWatermark,
  replaceNetIdentityState,
  serializeNetIdentityBackupPayload,
  upsertRetiredNets,
  writeNetIdentityBackup,
} from "../../../modules/designer/backend/net-identity/state-store";
import {
  NET_IDENTITY_BACKUP_FORMAT,
  NET_IDENTITY_MIGRATOR_VERSION,
  designNetSalt,
  formatDurableNetId,
  isDurableNetId,
  isDurableNetIdOf,
  isLoneNetId,
  isPendingNetId,
  seqOf,
  type ActiveNetRecord,
  type NetIdentityBackupPayload,
  type NetIdentityState,
} from "../../../modules/designer/backend/net-identity/types";
import type {
  pcbEntities,
  sessionHistories,
} from "../../../modules/designer/backend/schema";
import { getSharedDb, getSharedSqlite } from "../db/sqlite-client";
import { bootDesignerRuntime, type TestServer } from "./helpers/designer-runtime";
import type { DesignerSDK } from "../../../sdks";

const TS = "2026-10-15T00:00:00.000Z";
const LATER = "2026-10-15T01:00:00.000Z";

let sdk: DesignerSDK;
let server: TestServer;

beforeAll(async () => {
  ({ sdk, server } = await bootDesignerRuntime("designer-net-identity-store"));
});

function netId(designId: string, seq: number): string {
  return formatDurableNetId(designNetSalt(designId), seq);
}

function state(designId: string, overrides: Partial<NetIdentityState> = {}): NetIdentityState {
  return {
    designId,
    schemaVersion: 1,
    status: "active",
    nextSeq: 11,
    active: [],
    provenance: { origin: "native", createdAt: TS, migratorVersion: NET_IDENTITY_MIGRATOR_VERSION },
    lastError: null,
    ...overrides,
  };
}

function rawStateRow(designId: string) {
  return getSharedSqlite()
    .query<{ active_json: string; next_seq: number; status: string; updated_at: string }, [string]>(
      "SELECT active_json, next_seq, status, updated_at FROM designer_net_identity_state WHERE design_id = ?",
    )
    .get(designId);
}

function insertRawState(designId: string, columns: { activeJson?: string; nextSeq?: number; status?: string; schemaVersion?: number; provenanceJson?: string }): void {
  getSharedSqlite()
    .query(
      `INSERT INTO designer_net_identity_state
       (design_id, schema_version, status, next_seq, active_json, provenance_json, last_error, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      designId,
      columns.schemaVersion ?? 1,
      columns.status ?? "active",
      columns.nextSeq ?? 1,
      columns.activeJson ?? "[]",
      columns.provenanceJson ?? JSON.stringify({ origin: "native", createdAt: TS, migratorVersion: 1 }),
      null,
      TS,
    );
}

/** Independent oracle: the top 50 bits of the digest, five at a time. */
function bigintSalt(designId: string): string {
  const hex = createHash("sha256").update(designId, "utf8").digest("hex");
  let bits = BigInt(`0x${hex.slice(0, 13)}`) >> 2n;
  let salt = "";
  for (let index = 0; index < 10; index += 1) {
    salt = "abcdefghijklmnopqrstuvwxyz234567"[Number(bits & 31n)] + salt;
    bits >>= 5n;
  }
  return salt;
}

describe("durable net id format", () => {
  test("salt is RFC 4648 base32 of the first 50 bits of sha256(designId)", () => {
    // Golden vectors: python3 base64.b32encode(sha256(id).digest())[:10].lower()
    expect(designNetSalt("00000000-0000-4000-8000-000000000001")).toBe("chszj5ebsw");
    expect(designNetSalt("3f2c9a1e-7b4d-4e8a-9c1f-5a6b7c8d9e0f")).toBe("4dqkxmfmdt");
    expect(designNetSalt("design-a")).toBe("w73dimg5wl");
    expect(designNetSalt("design-b")).toBe("dd25ncdk4t");
    for (let index = 0; index < 200; index += 1) {
      const designId = crypto.randomUUID();
      const salt = designNetSalt(designId);
      expect(salt).toMatch(/^[a-z2-7]{10}$/);
      expect(salt).toBe(bigintSalt(designId));
    }
  });

  test("format round-trips through seqOf and the regex", () => {
    const salt = designNetSalt("design-a");
    for (const seq of [1, 9, 10, 4096, Number.MAX_SAFE_INTEGER]) {
      const id = formatDurableNetId(salt, seq);
      expect(id).toBe(`net:${salt}:${seq}`);
      expect(id).toMatch(/^net:[a-z2-7]{10}:[1-9][0-9]*$/);
      expect(isDurableNetId(id)).toBe(true);
      expect(seqOf(id)).toBe(seq);
    }
    for (const seq of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatDurableNetId(salt, seq)).toThrow(RangeError);
    }
    for (const bad of ["", "ABCDEFGHIJ", "abcdefghi", "abcdefghijk", "abcdefgh1j", "abcdefgh8j"]) {
      expect(() => formatDurableNetId(bad, 1)).toThrow(RangeError);
    }
  });

  test("classifies every id family; nothing else is durable", () => {
    const durable = ["net:abcdefghij:1", "net:abcdefghij:10", "net:a2b3c4d5e6:9007199254740991"];
    const notDurable = [
      "net:abcdefghij:0", "net:abcdefghij:01", "net:abcdefghij:", "net:ABCDEFGHIJ:1",
      "net:abcdefgh1j:1", "net:abcdefghi:1", "net:abcdefghijk:1", " net:abcdefghij:1",
      "net:abcdefghij:1 ", "NET:abcdefghij:1", "net:abcdefghij:9007199254740993",
      "pt:100:200", "w:wire-1:0", "nc:pin-1", "pending:3", "Net_3",
    ];
    for (const id of durable) expect(isDurableNetId(id)).toBe(true);
    for (const id of notDurable) {
      expect(isDurableNetId(id)).toBe(false);
      expect(seqOf(id)).toBeNull();
    }
    expect(isLoneNetId("nc:part-1:1")).toBe(true);
    expect(isLoneNetId("nc:")).toBe(false);
    expect(isLoneNetId("net:abcdefghij:1")).toBe(false);
    expect(isPendingNetId("pending:0")).toBe(true);
    expect(isPendingNetId("pending:12")).toBe(true);
    for (const id of ["pending:", "pending:x", "pending:-1", "pending:1 ", "nc:pending:1"]) {
      expect(isPendingNetId(id)).toBe(false);
    }
  });

  test("seq is numeric, so net:…:10 orders after net:…:9", () => {
    expect(seqOf("net:abcdefghij:10")! > seqOf("net:abcdefghij:9")!).toBe(true);
  });

  test("an id from another design is rejected by isDurableNetIdOf", () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const own = netId(first, 3);
    expect(isDurableNetIdOf(own, first)).toBe(true);
    expect(isDurableNetIdOf(own, second)).toBe(false);
    expect(isDurableNetIdOf(netId(second, 3), first)).toBe(false);
    expect(isDurableNetIdOf(`nc:${first}`, first)).toBe(false);
    expect(isDurableNetIdOf(`${own}0000000000000000000`, first)).toBe(false);
  });
});

describe("migration 0021 on boot", () => {
  test("is recorded and creates the four tables with the specified keys", () => {
    const sqlite = getSharedSqlite();
    const applied = sqlite
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM openpcb_migrations WHERE module_id = 'designer' AND migration_name = '0021_net_identity.sql'",
      )
      .get();
    expect(applied?.n).toBe(1);
    const columns = (table: string) =>
      sqlite
        .query<{ name: string; notnull: number; pk: number }, []>(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => `${column.name}${column.notnull ? "!" : ""}${column.pk ? `#${column.pk}` : ""}`);
    expect(columns("designer_net_identity_state")).toEqual([
      "design_id!#1", "schema_version!", "status!", "next_seq!", "active_json!",
      "provenance_json!", "last_error", "updated_at!",
    ]);
    expect(columns("designer_net_identity_retired")).toEqual([
      "design_id!#1", "net_id!#2", "seq!", "reason!", "successor_ids_json!", "display_name",
      "retired_at_revision!", "created_at!", "updated_at!",
    ]);
    expect(columns("designer_net_identity_quarantine")).toEqual([
      "design_id!#1", "ref_kind!#2", "ref_id!#3", "legacy_value!#4", "reason!",
      "candidates_json!", "suggested_net_id", "created_at!",
    ]);
    expect(columns("designer_net_identity_backups")).toEqual([
      "design_id!#1", "schema_version!#2", "revision!", "payload_json!", "sha256!", "created_at!",
    ]);
    const index = sqlite
      .query<{ name: string }, []>("PRAGMA index_info(designer_net_identity_retired_seq_idx)")
      .all()
      .map((column) => column.name);
    expect(index).toEqual(["design_id", "seq"]);
  });
});

describe("state row", () => {
  test("round-trips canonically: records by numeric seq, members by token, fixed keys", () => {
    const designId = crypto.randomUUID();
    const [n9, n10, n2] = [netId(designId, 9), netId(designId, 10), netId(designId, 2)];
    const active: ActiveNetRecord[] = [
      { id: n10, name: "GND", members: [{ kind: "wire", id: "w2" }, { kind: "pin", id: "p3" }] },
      { id: n9, name: "Net_9", members: [{ kind: "pin", id: "p2" }, { kind: "label", id: "l1" }], displayOverride: "SDA" },
      { id: n2, name: "Net_2", members: [{ kind: "primitive", id: "g1" }, { kind: "pin", id: "p1" }] },
    ];
    insertNetIdentityState(getSharedDb(), state(designId, { active }), TS);
    expect(rawStateRow(designId)?.active_json).toBe(
      JSON.stringify([
        { id: n2, name: "Net_2", members: [{ kind: "pin", id: "p1" }, { kind: "primitive", id: "g1" }] },
        { id: n9, name: "Net_9", members: [{ kind: "label", id: "l1" }, { kind: "pin", id: "p2" }], displayOverride: "SDA" },
        { id: n10, name: "GND", members: [{ kind: "pin", id: "p3" }, { kind: "wire", id: "w2" }] },
      ]),
    );
    const read = readNetIdentityState(getSharedDb(), designId);
    expect(read?.active.map((record) => record.id)).toEqual([n2, n9, n10]);
    expect(read?.active[1]).toEqual({
      id: n9, name: "Net_9", members: [{ kind: "label", id: "l1" }, { kind: "pin", id: "p2" }], displayOverride: "SDA",
    });
    expect("displayOverride" in read!.active[0]!).toBe(false);
    expect(read).toMatchObject({ designId, schemaVersion: 1, status: "active", nextSeq: 11, lastError: null });
  });

  test("provenance with a migration report and restoredAt round-trips", () => {
    const designId = crypto.randomUUID();
    const provenance = {
      origin: "legacy-migration" as const,
      createdAt: TS,
      migratorVersion: 1,
      migration: {
        schemaVersion: 1 as const, migratorVersion: 1, revisionBefore: 41, revisionAfter: 42, netsAllocated: 3,
        references: {
          total: 5,
          bound: { rootAndContact: 2, rootAndPour: 1, contact: 0, nameHint: 1, autoNameHint: 0 },
          quarantined: { stale_root: 1 },
        },
        historiesArchived: 2,
        boardSettings: "migrated" as const,
      },
      restoredAt: LATER,
    };
    insertNetIdentityState(getSharedDb(), state(designId, { status: "legacy_restored", nextSeq: 1, provenance, lastError: "x" }), TS);
    expect(readNetIdentityState(getSharedDb(), designId)).toEqual(
      state(designId, { status: "legacy_restored", nextSeq: 1, provenance, lastError: "x" }),
    );
  });

  test("a second insert for the same design hits the primary key and changes nothing", () => {
    const designId = crypto.randomUUID();
    insertNetIdentityState(getSharedDb(), state(designId, { nextSeq: 4 }), TS);
    expect(() => insertNetIdentityState(getSharedDb(), state(designId, { nextSeq: 9 }), LATER)).toThrow();
    expect(rawStateRow(designId)).toMatchObject({ next_seq: 4, updated_at: TS });
  });

  test("refuses to persist ids that are not this design's durable ids, and other corruption", () => {
    const designId = crypto.randomUUID();
    const foreign = netId(crypto.randomUUID(), 1);
    const own = netId(designId, 1);
    const pin = (id: string) => ({ kind: "pin" as const, id });
    const bad: Array<Partial<NetIdentityState>> = [
      { active: [{ id: "nc:p1", name: "x", members: [pin("p1")] }] },
      { active: [{ id: "pending:0", name: "x", members: [pin("p1")] }] },
      { active: [{ id: "pt:1:2", name: "x", members: [pin("p1")] }] },
      { active: [{ id: foreign, name: "x", members: [pin("p1")] }] },
      { active: [{ id: own, name: "a", members: [pin("p1")] }, { id: own, name: "b", members: [pin("p2")] }] },
      { active: [{ id: own, name: "a", members: [pin("p1")] }, { id: netId(designId, 2), name: "b", members: [pin("p1")] }] },
      { active: [{ id: own, name: "a", members: [pin("p1"), pin("p1")] }] },
      { active: [{ id: netId(designId, 11), name: "x", members: [pin("p1")] }] },
      { nextSeq: 0 },
      { status: "migration_failed", active: [{ id: own, name: "x", members: [pin("p1")] }] },
      { active: [{ id: own, name: "x", members: [{ kind: "pad" as never, id: "p1" }] }] },
    ];
    for (const overrides of bad) {
      expect(() => insertNetIdentityState(getSharedDb(), state(designId, overrides), TS)).toThrow();
    }
    expect(rawStateRow(designId)).toBeNull();
  });

  test("replace rewrites the row but never moves an active counter backwards", () => {
    const designId = crypto.randomUUID();
    const db = getSharedDb();
    expect(() => replaceNetIdentityState(db, state(designId), TS)).toThrow(/No net identity state/);
    insertNetIdentityState(db, state(designId, { nextSeq: 8 }), TS);
    const record = { id: netId(designId, 8), name: "Net_8", members: [{ kind: "pin" as const, id: "p1" }] };
    replaceNetIdentityState(db, state(designId, { nextSeq: 9, active: [record] }), LATER);
    expect(readNetIdentityState(db, designId)?.active).toEqual([record]);
    expect(() => replaceNetIdentityState(db, state(designId, { nextSeq: 8 }), LATER)).toThrow(/back to 8/);
    expect(rawStateRow(designId)?.next_seq).toBe(9);
    replaceNetIdentityState(db, state(designId, { status: "legacy_restored", nextSeq: 1 }), LATER);
    expect(readNetIdentityState(db, designId)).toMatchObject({ status: "legacy_restored", nextSeq: 1, active: [] });
    deleteNetIdentityState(db, designId);
    expect(readNetIdentityState(db, designId)).toBeNull();
  });

  test("reads tolerate a member in two records and a corrupt next_seq (§5 #11, #12)", () => {
    const designId = crypto.randomUUID();
    const [a, b] = [netId(designId, 2), netId(designId, 1)];
    const activeJson = JSON.stringify([
      { id: a, name: "A", members: [{ kind: "pin", id: "p2" }, { kind: "pin", id: "p1" }] },
      { id: b, name: "B", members: [{ kind: "pin", id: "p2" }] },
    ]);
    insertRawState(designId, { activeJson, nextSeq: -4 });
    const read = readNetIdentityState(getSharedDb(), designId);
    expect(read?.nextSeq).toBe(1);
    expect(read?.active).toEqual(JSON.parse(activeJson) as ActiveNetRecord[]);
  });

  test("structural damage throws NetIdentityStateError with a reason", () => {
    const own = (designId: string) => netId(designId, 1);
    const cases: Array<[(designId: string) => Parameters<typeof insertRawState>[1], NetIdentityStateErrorReason]> = [
      [() => ({ activeJson: "{not json" }), "corrupt"],
      [() => ({ activeJson: "{}" }), "corrupt"],
      [() => ({ activeJson: JSON.stringify([{ id: "nc:p1", name: "x", members: [] }]) }), "corrupt"],
      [() => ({ activeJson: JSON.stringify([{ id: netId(crypto.randomUUID(), 1), name: "x", members: [] }]) }), "corrupt"],
      [(designId) => ({ activeJson: JSON.stringify([{ id: own(designId), name: "x", members: [{ kind: "pad", id: "p" }] }]) }), "corrupt"],
      [(designId) => ({ activeJson: JSON.stringify([{ id: own(designId), name: "a", members: [] }, { id: own(designId), name: "b", members: [] }]) }), "corrupt"],
      [() => ({ status: "frozen" }), "corrupt"],
      [() => ({ provenanceJson: JSON.stringify({ origin: "cloud", createdAt: TS, migratorVersion: 1 }) }), "corrupt"],
      [() => ({ schemaVersion: 2 }), "unsupported_schema_version"],
    ];
    for (const [columns, reason] of cases) {
      const designId = crypto.randomUUID();
      insertRawState(designId, columns(designId));
      let caught: unknown;
      try {
        readNetIdentityState(getSharedDb(), designId);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NetIdentityStateError);
      expect((caught as NetIdentityStateError).reason).toBe(reason);
      expect((caught as NetIdentityStateError).designId).toBe(designId);
    }
  });
});

describe("retirement ledger and seq watermark", () => {
  test("watermark = max(next_seq, 1 + max ledger seq), never below 1, per design", () => {
    const db = getSharedDb();
    const designId = crypto.randomUUID();
    const other = crypto.randomUUID();
    expect(readSeqWatermark(db, designId)).toBe(1);
    insertNetIdentityState(db, state(designId, { nextSeq: 5 }), TS);
    expect(readSeqWatermark(db, designId)).toBe(5);
    upsertRetiredNets(db, other, [{ netId: netId(other, 40), reason: "removed", successorIds: [], displayName: null, retiredAtRevision: 1 }], TS);
    expect(readSeqWatermark(db, designId)).toBe(5);
    upsertRetiredNets(db, designId, [
      { netId: netId(designId, 9), reason: "merged", successorIds: [], displayName: "Net_9", retiredAtRevision: 3 },
      { netId: netId(designId, 12), reason: "split", successorIds: [], displayName: "Net_12", retiredAtRevision: 4 },
    ], TS);
    // A corrupt next_seq below the ledger is defended by the ledger term.
    expect(readSeqWatermark(db, designId)).toBe(13);
    const corrupt = crypto.randomUUID();
    insertRawState(corrupt, { nextSeq: 0 });
    expect(readSeqWatermark(db, corrupt)).toBe(1);
  });

  test("the watermark query is served by the (design_id, seq) index", () => {
    const plan = getSharedSqlite()
      .query<{ detail: string }, [string]>(
        "EXPLAIN QUERY PLAN SELECT max(seq) FROM designer_net_identity_retired WHERE design_id = ?",
      )
      .all("design")
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("designer_net_identity_retired_seq_idx");
  });

  test("upsert derives seq from the id, keeps created_at and lists by numeric seq", () => {
    const db = getSharedDb();
    const designId = crypto.randomUUID();
    const [n9, n10] = [netId(designId, 9), netId(designId, 10)];
    upsertRetiredNets(db, designId, [
      { netId: n10, reason: "split", successorIds: ["nc:p4", netId(designId, 11)], displayName: "VCC", retiredAtRevision: 6 },
      { netId: n9, reason: "removed", successorIds: [], displayName: null, retiredAtRevision: 5 },
    ], TS);
    upsertRetiredNets(db, designId, [
      { netId: n10, reason: "history", successorIds: [], displayName: "VCC", retiredAtRevision: 8 },
    ], LATER);
    expect(listRetiredNets(db, designId)).toEqual([
      { designId, netId: n9, seq: 9, reason: "removed", successorIds: [], displayName: null, retiredAtRevision: 5, createdAt: TS, updatedAt: TS },
      { designId, netId: n10, seq: 10, reason: "history", successorIds: [], displayName: "VCC", retiredAtRevision: 8, createdAt: TS, updatedAt: LATER },
    ]);
    expect(readRetiredNet(db, designId, n9)?.seq).toBe(9);
    expect(readRetiredNet(db, designId, netId(designId, 99))).toBeNull();
    deleteRetiredNets(db, designId);
    expect(listRetiredNets(db, designId)).toEqual([]);
  });

  test("refuses lone, pending, legacy and foreign ids and unknown reasons", () => {
    const db = getSharedDb();
    const designId = crypto.randomUUID();
    const entry = { reason: "removed" as const, successorIds: [], displayName: null, retiredAtRevision: 1 };
    for (const id of ["nc:p1", "pending:1", "pt:0:0", netId(crypto.randomUUID(), 1)]) {
      expect(() => upsertRetiredNets(db, designId, [{ ...entry, netId: id }], TS)).toThrow();
    }
    expect(() => upsertRetiredNets(db, designId, [{ ...entry, netId: netId(designId, 1), reason: "lost" as never }], TS)).toThrow();
    expect(listRetiredNets(db, designId)).toEqual([]);
  });
});

describe("quarantine provenance", () => {
  test("rows round-trip, sort by key and are never overwritten", () => {
    const db = getSharedDb();
    const designId = crypto.randomUUID();
    const suggestion = netId(designId, 2);
    insertQuarantineRecords(db, designId, [
      { refKind: "zone", refId: "z1", legacyValue: "VCC", reason: "ambiguous_name", candidates: [netId(designId, 1), suggestion], suggestedNetId: null },
      { refKind: "trace", refId: "t1", legacyValue: "pt:1:2", reason: "stale_root", candidates: [], suggestedNetId: suggestion },
    ], TS);
    insertQuarantineRecords(db, designId, [
      { refKind: "trace", refId: "t1", legacyValue: "pt:1:2", reason: "short", candidates: ["x"], suggestedNetId: null },
    ], LATER);
    expect(listQuarantineRecords(db, designId)).toEqual([
      { designId, refKind: "trace", refId: "t1", legacyValue: "pt:1:2", reason: "stale_root", candidates: [], suggestedNetId: suggestion, createdAt: TS },
      { designId, refKind: "zone", refId: "z1", legacyValue: "VCC", reason: "ambiguous_name", candidates: [netId(designId, 1), suggestion], suggestedNetId: null, createdAt: TS },
    ]);
    expect(() =>
      insertQuarantineRecords(db, designId, [{ refKind: "pad" as never, refId: "p", legacyValue: "v", reason: "short", candidates: [], suggestedNetId: null }], TS),
    ).toThrow();
    deleteQuarantineRecords(db, designId);
    expect(listQuarantineRecords(db, designId)).toEqual([]);
  });
});

type PcbEntityRow = typeof pcbEntities.$inferSelect;
type SessionHistoryRow = typeof sessionHistories.$inferSelect;

function backupPayload(designId: string, revision: number): NetIdentityBackupPayload {
  const pcb = (id: string): PcbEntityRow => ({
    // Keys deliberately out of column order.
    updatedAt: TS, payloadJson: `{"id":"${id}","netId":"pt:1:2"}`, kind: "trace", designId, id, createdAt: TS,
  });
  const history: SessionHistoryRow = {
    id: "h1", designId, sessionId: "s1", undoStackJson: "[]", redoStackJson: "[]", updatedAt: TS,
  };
  return {
    format: NET_IDENTITY_BACKUP_FORMAT,
    designId,
    revision,
    schematic: {
      parts: [],
      pins: [],
      wires: [
        { id: "w2", designId, sourcePinId: "p2", targetPinId: "p3", pointsJson: "[]", routeStatus: null, createdAt: TS, updatedAt: TS },
        { id: "w1", designId, sourcePinId: "p1", targetPinId: "p2", pointsJson: "[]", routeStatus: "colliding", createdAt: TS, updatedAt: TS },
      ],
      labels: [{ id: "l1", designId, text: "VCC", xNm: 1, yNm: -2, createdAt: TS, updatedAt: TS }],
      primitives: [],
    },
    pcbEntities: [pcb("t2"), pcb("t10"), pcb("t1")],
    sessionHistories: [history],
  };
}

describe("logical backup", () => {
  test("payload has a fixed key order, rows by id in column order, and a verifying sha256", () => {
    const db = getSharedDb();
    const designId = crypto.randomUUID();
    const payload = backupPayload(designId, 41);
    const sha = writeNetIdentityBackup(db, payload, TS);
    const backup = readNetIdentityBackup(db, designId);
    expect(backup?.verified).toBe(true);
    expect(backup?.sha256).toBe(sha);
    expect(sha).toBe(createHash("sha256").update(backup!.payloadJson, "utf8").digest("hex"));
    expect(backup?.revision).toBe(41);
    const parsed = JSON.parse(backup!.payloadJson) as Record<string, unknown> & {
      schematic: Record<string, unknown>;
      pcbEntities: Array<Record<string, unknown>>;
    };
    expect(Object.keys(parsed)).toEqual(["format", "designId", "revision", "schematic", "pcbEntities", "sessionHistories"]);
    expect(Object.keys(parsed.schematic)).toEqual(["parts", "pins", "wires", "labels", "primitives"]);
    expect(parsed.pcbEntities.map((row) => row.id)).toEqual(["t1", "t10", "t2"]);
    expect(Object.keys(parsed.pcbEntities[0]!)).toEqual(["id", "designId", "kind", "payloadJson", "createdAt", "updatedAt"]);
    // Every column survives verbatim, nulls included.
    expect(backup?.payload?.schematic.wires).toEqual([payload.schematic.wires[1]!, payload.schematic.wires[0]!]);
    expect(backup?.payload?.sessionHistories).toEqual(payload.sessionHistories);
  });

  test("serialisation is independent of input order; a rewrite replaces the row", () => {
    const db = getSharedDb();
    const designId = crypto.randomUUID();
    const payload = backupPayload(designId, 41);
    const shuffled = { ...payload, pcbEntities: [...payload.pcbEntities].reverse() };
    expect(serializeNetIdentityBackupPayload(shuffled)).toBe(serializeNetIdentityBackupPayload(payload));
    writeNetIdentityBackup(db, payload, TS);
    writeNetIdentityBackup(db, backupPayload(designId, 7), LATER);
    const rows = getSharedSqlite()
      .query<{ revision: number; created_at: string }, [string]>(
        "SELECT revision, created_at FROM designer_net_identity_backups WHERE design_id = ?",
      )
      .all(designId);
    expect(rows).toEqual([{ revision: 7, created_at: LATER }]);
  });

  test("a tampered payload or digest does not verify", () => {
    const db = getSharedDb();
    const sqlite = getSharedSqlite();
    const designId = crypto.randomUUID();
    writeNetIdentityBackup(db, backupPayload(designId, 3), TS);
    sqlite
      .query("UPDATE designer_net_identity_backups SET payload_json = replace(payload_json, 'VCC', 'GND') WHERE design_id = ?")
      .run(designId);
    expect(readNetIdentityBackup(db, designId)).toMatchObject({ verified: false, payload: null });
    // A matching digest over a payload of another design or revision still fails.
    const foreign = JSON.stringify({ ...JSON.parse(serializeNetIdentityBackupPayload(backupPayload(designId, 4))) });
    sqlite
      .query("UPDATE designer_net_identity_backups SET payload_json = ?, sha256 = ? WHERE design_id = ?")
      .run(foreign, createHash("sha256").update(foreign).digest("hex"), designId);
    expect(readNetIdentityBackup(db, designId)).toMatchObject({ verified: false, payload: null });
    expect(readNetIdentityBackup(db, crypto.randomUUID())).toBeNull();
  });

  test("a row missing a column is refused rather than silently dropped", () => {
    const payload = backupPayload(crypto.randomUUID(), 1);
    const { routeStatus: _dropped, ...partial } = payload.schematic.wires[0]!;
    const broken = {
      ...payload,
      schematic: { ...payload.schematic, wires: [partial as typeof payload.schematic.wires[number]] },
    };
    expect(() => serializeNetIdentityBackupPayload(broken)).toThrow(/lacks column routeStatus/);
  });
});

describe("deleteDesign", () => {
  function counts(designId: string): number[] {
    return [
      "designer_net_identity_state",
      "designer_net_identity_retired",
      "designer_net_identity_quarantine",
      "designer_net_identity_backups",
    ].map(
      (table) =>
        getSharedSqlite()
          .query<{ n: number }, [string]>(`SELECT count(*) AS n FROM ${table} WHERE design_id = ?`)
          .get(designId)?.n ?? -1,
    );
  }

  function seed(designId: string): void {
    const db = getSharedDb();
    const record = { id: netId(designId, 1), name: "Net_1", members: [{ kind: "pin" as const, id: "p1" }] };
    insertNetIdentityState(db, state(designId, { nextSeq: 3, active: [record] }), TS);
    upsertRetiredNets(db, designId, [{ netId: netId(designId, 2), reason: "merged", successorIds: [record.id], displayName: "Net_2", retiredAtRevision: 1 }], TS);
    insertQuarantineRecords(db, designId, [{ refKind: "via", refId: "v1", legacyValue: "pt:0:0", reason: "root_only", candidates: [], suggestedNetId: record.id }], TS);
    writeNetIdentityBackup(db, backupPayload(designId, 1), TS);
  }

  test("clears all four net-identity tables for the deleted design only", async () => {
    const target = await sdk.createDesign({ name: "Net identity delete" });
    const survivor = await sdk.createDesign({ name: "Net identity keep" });
    seed(target.id);
    seed(survivor.id);
    expect(counts(target.id)).toEqual([1, 1, 1, 1]);
    const response = await server.fetch(
      new Request(`http://localhost/api/modules/designer/designs/${target.id}`, { method: "DELETE" }),
    );
    expect(response.status).toBe(204);
    expect(counts(target.id)).toEqual([0, 0, 0, 0]);
    expect(counts(survivor.id)).toEqual([1, 1, 1, 1]);
    expect(readNetIdentityBackup(getSharedDb(), survivor.id)?.verified).toBe(true);
  });
});
