import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Logger } from "../../contracts/modules/backend-module";
import { captureNetIdentityBackup } from "../../../modules/designer/backend/net-identity/backup";
import { ensureNetIdentity, retryNetIdentityMigration } from "../../../modules/designer/backend/net-identity/ensure";
import { restoreLegacyNetIdentity } from "../../../modules/designer/backend/net-identity/restore";
import {
  readNetIdentityRetired, readNetIdentityState, writeNetIdentityRetired, writeNetIdentityState, type NetIdentityDb,
} from "../../../modules/designer/backend/net-identity/state-store";
import {
  designNetSalt, formatDurableNetId, seqOf, type NetIdentityState,
} from "../../../modules/designer/backend/net-identity/types";
import { designHeads, netIdentityState, pcbEntities } from "../../../modules/designer/backend/schema";
import {
  MIGRATION_TS, migrationFixture, patchEntity, rawDatabase, type MigrationFixture,
} from "./helpers/net-identity-migration-fixture";

function logger() {
  const warnings: unknown[] = [], errors: unknown[] = [];
  const value: Logger = { debug() {}, info() {}, warn: (...args) => { warnings.push(args); }, error: (...args) => { errors.push(args); } };
  return { value, warnings, errors };
}

function failedState(fixture: MigrationFixture, nextSeq = 30): NetIdentityState {
  return {
    designId: fixture.designId, schemaVersion: 1, status: "migration_failed", nextSeq, active: [],
    provenance: { origin: "legacy-migration", createdAt: MIGRATION_TS, migratorVersion: 1 },
    lastError: "derive: prior failure", updatedAt: MIGRATION_TS,
  };
}

function afterRollback(fixture: MigrationFixture, intervene: () => void): NetIdentityDb {
  let intervened = false;
  return new Proxy(fixture.db, {
    get(target, key, receiver) {
      if (key !== "transaction") return Reflect.get(target, key, receiver) as unknown;
      return <T>(work: (tx: unknown) => T): T => {
        try { return target.transaction((tx) => work(tx)); }
        catch (error) {
          if (!intervened) { intervened = true; intervene(); }
          throw error;
        }
      };
    },
  });
}

describe("ensure identity never throws", () => {
  test("missing head returns unmigrated without writes", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      const before = rawDatabase(fixture.sqlite);
      expect(ensureNetIdentity(fixture.db, "missing", log.value)).toBe("unmigrated");
      expect(retryNetIdentityMigration(fixture.db, "missing", log.value)).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
    } finally { fixture.sqlite.close(); }
  });

  test("real initial migration succeeds and active calls do nothing", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value)).toBe("active");
      const before = rawDatabase(fixture.sqlite);
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value, { fault: () => { throw new Error("must not retry"); } })).toBe("active");
      expect(retryNetIdentityMigration(fixture.db, fixture.designId, log.value)).toBe("active");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
      expect(log.errors).toEqual([]);
    } finally { fixture.sqlite.close(); }
  });

  const transients = [
    "SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_LOCKED", "SQLITE_LOCKED_SHAREDCACHE", "SQLITE_IOERR",
    "SQLITE_IOERR_WRITE", "SQLITE_FULL", "SQLITE_READONLY", "SQLITE_READONLY_DBMOVED", "SQLITE_CANTOPEN",
    "SQLITE_CANTOPEN_FULLPATH", "SQLITE_INTERRUPT",
  ];
  test.each(transients)("nested %s is transient and writes nothing", (code) => {
    const fixture = migrationFixture(), log = logger();
    try {
      const before = rawDatabase(fixture.sqlite);
      const cause = Object.assign(new Error("sqlite failure"), { code });
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value, {
        fault: (stage) => { if (stage === "state") throw new Error("wrapped", { cause }); },
      })).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
      expect(log.warnings).toHaveLength(1); expect(log.errors).toEqual([]);
    } finally { fixture.sqlite.close(); }
  });

  test("deterministic failure marks failed but preserves all original source/history bytes", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      const original = captureNetIdentityBackup(fixture.db, fixture.designId, MIGRATION_TS).payloadJson;
      const id = formatDurableNetId(designNetSalt(fixture.designId), 77);
      patchEntity(fixture, "trace", (raw) => { raw.futureReference = id; });
      const source = captureNetIdentityBackup(fixture.db, fixture.designId, MIGRATION_TS).payloadJson;
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value, {
        fault: (stage) => { if (stage === "derive") throw new Error("bad source"); },
      })).toBe("migration_failed");
      const state = readNetIdentityState(fixture.db, fixture.designId)!;
      expect(state).toMatchObject({ status: "migration_failed", nextSeq: 78, active: [], lastError: "derive: bad source" });
      expect(captureNetIdentityBackup(fixture.db, fixture.designId, MIGRATION_TS).payloadJson).toBe(source);
      expect(source).not.toBe(original);
      expect(log.errors).toHaveLength(1);
      let retried = false;
      const before = rawDatabase(fixture.sqlite);
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value, { fault: () => { retried = true; } })).toBe("migration_failed");
      expect(retried).toBe(false); expect(rawDatabase(fixture.sqlite)).toBe(before);
    } finally { fixture.sqlite.close(); }
  });

  test("explicit retry keeps failed counter until success and creates higher IDs", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      writeNetIdentityState(fixture.db, failedState(fixture, 70));
      expect(retryNetIdentityMigration(fixture.db, fixture.designId, log.value)).toBe("active");
      const state = readNetIdentityState(fixture.db, fixture.designId)!;
      expect(state.active.map((row) => seqOf(row.id))).toEqual([70, 71, 72]);
      expect(state.nextSeq).toBe(73);
    } finally { fixture.sqlite.close(); }
  });

  test("ensure respects restored status; explicit restored retry allocates fresh IDs", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      fixture.migrate();
      const first = readNetIdentityState(fixture.db, fixture.designId)!;
      restoreLegacyNetIdentity(fixture.db, fixture.designId, { timestamp: MIGRATION_TS, confirmDiscardRevisions: false });
      const before = rawDatabase(fixture.sqlite);
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value)).toBe("legacy_restored");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
      expect(retryNetIdentityMigration(fixture.db, fixture.designId, log.value)).toBe("active");
      const next = readNetIdentityState(fixture.db, fixture.designId)!;
      expect(Math.min(...next.active.map((row) => seqOf(row.id)!))).toBeGreaterThan(Math.max(...first.active.map((row) => seqOf(row.id)!)));
    } finally { fixture.sqlite.close(); }
  });

  test.each(["schemaVersion", "activeJson", "provenanceJson"])("invalid raw %s is not overwritten", (field) => {
    const fixture = migrationFixture(), log = logger();
    try {
      writeNetIdentityState(fixture.db, failedState(fixture));
      const changes = field === "schemaVersion" ? { schemaVersion: 99 } : { [field]: "{bad" };
      fixture.db.update(netIdentityState).set(changes).where(eq(netIdentityState.designId, fixture.designId)).run();
      const before = rawDatabase(fixture.sqlite);
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value)).toBe("unmigrated");
      expect(retryNetIdentityMigration(fixture.db, fixture.designId, log.value)).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
    } finally { fixture.sqlite.close(); }
  });

  test("contested persisted active members remain unavailable and byte-exact", () => {
    const fixture = migrationFixture();
    const minimalLogger: Pick<Logger, "warn" | "error"> = { warn() {}, error() {} };
    try {
      fixture.migrate();
      const state = readNetIdentityState(fixture.db, fixture.designId)!;
      state.active[1]!.members.push({ ...state.active[0]!.members[0]! });
      fixture.db.update(netIdentityState).set({ activeJson: JSON.stringify(state.active) })
        .where(eq(netIdentityState.designId, fixture.designId)).run();
      const before = rawDatabase(fixture.sqlite);
      expect(ensureNetIdentity(fixture.db, fixture.designId, minimalLogger)).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
      expect(retryNetIdentityMigration(fixture.db, fixture.designId, minimalLogger)).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
    } finally { fixture.sqlite.close(); }
  });

  test("initial database failure and throwing logger stay contained", () => {
    const fixture = migrationFixture();
    const throwingLogger: Logger = { debug() {}, info() {}, warn() { throw new Error("logger"); }, error() { throw new Error("logger"); } };
    try {
      const broken = new Proxy(fixture.db, { get() { throw new Error("database unavailable"); } });
      expect(ensureNetIdentity(broken, fixture.designId, throwingLogger)).toBe("unmigrated");
      expect(retryNetIdentityMigration(broken, fixture.designId, throwingLogger)).toBe("unmigrated");
      expect(ensureNetIdentity(fixture.db, fixture.designId, throwingLogger, { fault: () => { throw new Error("bad source"); } })).toBe("migration_failed");
    } finally { fixture.sqlite.close(); }
  });

  test("failure marker write failure leaves source and identity tables untouched", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      fixture.sqlite.exec("CREATE TRIGGER reject_failed_state BEFORE INSERT ON designer_net_identity_state BEGIN SELECT RAISE(ABORT, 'marker write blocked'); END");
      const before = rawDatabase(fixture.sqlite);
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value, { fault: () => { throw new Error("bad source"); } })).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
    } finally { fixture.sqlite.close(); }
  });

  test("only state primary-key constraint rereads a concurrent winner", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      const db = afterRollback(fixture, () => { fixture.migrate(); });
      const cause = Object.assign(new Error("UNIQUE constraint failed: designer_net_identity_state.design_id"), { code: "SQLITE_CONSTRAINT_PRIMARYKEY" });
      expect(ensureNetIdentity(db, fixture.designId, log.value, { fault: () => { throw cause; } })).toBe("active");
      expect(readNetIdentityState(fixture.db, fixture.designId)!.status).toBe("active");
      expect(log.errors).toEqual([]);
    } finally { fixture.sqlite.close(); }
  });

  test("unrelated primary-key constraint is deterministic", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      const cause = Object.assign(new Error("UNIQUE constraint failed: designer_pcb_entities.id"), { code: "SQLITE_CONSTRAINT_PRIMARYKEY" });
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value, { fault: () => { throw cause; } })).toBe("migration_failed");
      expect(readNetIdentityState(fixture.db, fixture.designId)!.lastError).toContain("designer_pcb_entities.id");
    } finally { fixture.sqlite.close(); }
  });

  test("deterministic failure cannot overwrite a concurrent active or restored state", () => {
    for (const status of ["active", "legacy_restored"] as const) {
      const fixture = migrationFixture(), log = logger();
      try {
        const db = afterRollback(fixture, () => {
          fixture.migrate();
          if (status === "legacy_restored") restoreLegacyNetIdentity(fixture.db, fixture.designId, { timestamp: MIGRATION_TS, confirmDiscardRevisions: false });
        });
        expect(ensureNetIdentity(db, fixture.designId, log.value, { fault: () => { throw new Error("bad source"); } })).toBe(status);
        expect(readNetIdentityState(fixture.db, fixture.designId)!.status).toBe(status);
      } finally { fixture.sqlite.close(); }
    }
  });

  test("head change after failed attempt prevents stale failure marker", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      const db = afterRollback(fixture, () => {
        fixture.db.update(designHeads).set({ revision: fixture.input.payload.revision + 1 }).where(eq(designHeads.id, fixture.designId)).run();
      });
      expect(ensureNetIdentity(db, fixture.designId, log.value, { fault: () => { throw new Error("bad source"); } })).toBe("unmigrated");
      expect(readNetIdentityState(fixture.db, fixture.designId)).toBeNull();
    } finally { fixture.sqlite.close(); }
  });

  test("unsupported state arriving after rollback stays byte-exact", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      let expected = "";
      const db = afterRollback(fixture, () => {
        writeNetIdentityState(fixture.db, failedState(fixture));
        fixture.db.update(netIdentityState).set({ schemaVersion: 99 }).run();
        expected = rawDatabase(fixture.sqlite);
      });
      expect(ensureNetIdentity(db, fixture.designId, log.value, { fault: () => { throw new Error("bad source"); } })).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(expected);
    } finally { fixture.sqlite.close(); }
  });

  test("retired ledger and restored creation provenance survive deterministic retry failure", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      fixture.migrate();
      restoreLegacyNetIdentity(fixture.db, fixture.designId, { timestamp: MIGRATION_TS, confirmDiscardRevisions: false });
      const before = readNetIdentityState(fixture.db, fixture.designId)!;
      writeNetIdentityRetired(fixture.db, {
        designId: fixture.designId, netId: formatDurableNetId(designNetSalt(fixture.designId), 100), seq: 100,
        reason: "removed", successorIds: [], displayName: null, retiredAtRevision: fixture.input.payload.revision,
        createdAt: MIGRATION_TS, updatedAt: MIGRATION_TS,
      });
      const retired = readNetIdentityRetired(fixture.db, fixture.designId);
      const row = fixture.rows().find((entry) => entry.kind === "trace")!;
      fixture.db.update(pcbEntities).set({ payloadJson: "{bad" }).where(eq(pcbEntities.id, row.id)).run();
      expect(retryNetIdentityMigration(fixture.db, fixture.designId, log.value)).toBe("migration_failed");
      const failed = readNetIdentityState(fixture.db, fixture.designId)!;
      expect(failed.nextSeq).toBe(101);
      expect(failed.provenance.createdAt).toBe(before.provenance.createdAt);
      expect(failed.provenance.restoredAt).toBe(before.provenance.restoredAt);
      expect(readNetIdentityRetired(fixture.db, fixture.designId)).toEqual(retired);
    } finally { fixture.sqlite.close(); }
  });

  test("unprovable exhausted watermark does not create a lower failed marker", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      patchEntity(fixture, "trace", (raw) => { raw.future = formatDurableNetId(designNetSalt(fixture.designId), Number.MAX_SAFE_INTEGER); });
      const before = rawDatabase(fixture.sqlite);
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value)).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
    } finally { fixture.sqlite.close(); }
  });

  test("state constraint without a valid winning row is unavailable, not a failed marker", () => {
    const fixture = migrationFixture(), log = logger();
    try {
      const before = rawDatabase(fixture.sqlite);
      const cause = Object.assign(new Error("UNIQUE constraint failed: designer_net_identity_state.design_id"), { code: "SQLITE_CONSTRAINT" });
      expect(ensureNetIdentity(fixture.db, fixture.designId, log.value, { fault: () => { throw cause; } })).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
    } finally { fixture.sqlite.close(); }
  });

  test("throwing warning logger and cyclic error causes cannot escape", () => {
    const fixture = migrationFixture();
    const throwing = new Proxy(logger().value, { get() { throw new Error("logging unavailable"); } });
    try {
      const before = rawDatabase(fixture.sqlite);
      const cause = Object.assign(new Error("busy"), { code: "SQLITE_BUSY" });
      expect(ensureNetIdentity(fixture.db, fixture.designId, throwing, { fault: () => { throw cause; } })).toBe("unmigrated");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
      const cycle = new Error("cycle"); cycle.cause = cycle;
      expect(ensureNetIdentity(fixture.db, fixture.designId, throwing, { fault: () => { throw cycle; } })).toBe("migration_failed");
    } finally { fixture.sqlite.close(); }
  });

  test("older valid migrator version retries in an isolated module environment", () => {
    const typesPath = new URL("../../../modules/designer/backend/net-identity/types.ts", import.meta.url).pathname;
    const ensurePath = new URL("../../../modules/designer/backend/net-identity/ensure.ts", import.meta.url).pathname;
    const fixturePath = new URL("./helpers/net-identity-migration-fixture.ts", import.meta.url).pathname;
    const storePath = new URL("../../../modules/designer/backend/net-identity/state-store.ts", import.meta.url).pathname;
    const script = `
      import { mock } from "bun:test";
      const types = await import(${JSON.stringify(typesPath)});
      mock.module(${JSON.stringify(typesPath)}, () => ({ ...types, NET_IDENTITY_MIGRATOR_VERSION: 2 }));
      const { ensureNetIdentity } = await import(${JSON.stringify(ensurePath)});
      const { migrationFixture, MIGRATION_TS } = await import(${JSON.stringify(fixturePath)});
      const { readNetIdentityState, writeNetIdentityState } = await import(${JSON.stringify(storePath)});
      const fixture = migrationFixture();
      try {
        writeNetIdentityState(fixture.db, {
          designId: fixture.designId, schemaVersion: 1, status: "migration_failed", nextSeq: 40, active: [],
          provenance: { origin: "legacy-migration", createdAt: MIGRATION_TS, migratorVersion: 1 },
          lastError: "old failure", updatedAt: MIGRATION_TS,
        });
        const status = ensureNetIdentity(fixture.db, fixture.designId, { debug() {}, info() {}, warn() {}, error() {} });
        const state = readNetIdentityState(fixture.db, fixture.designId);
        console.log(JSON.stringify({ status, nextSeq: state.nextSeq, version: state.provenance.migratorVersion }));
      } finally { fixture.sqlite.close(); }
    `;
    const result = Bun.spawnSync([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ status: "active", nextSeq: 43, version: 2 });
  });
});
