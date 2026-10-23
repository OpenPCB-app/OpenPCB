import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  NetIdentityMigrationError, type MigrationStage,
} from "../../../modules/designer/backend/net-identity/migrate";
import { legacyFillRowId } from "../../../modules/designer/backend/net-identity/migration-source";
import { restoreLegacyNetIdentity } from "../../../modules/designer/backend/net-identity/restore";
import {
  readNetIdentityBackup, readNetIdentityQuarantine, readNetIdentityRetired, readNetIdentityState,
} from "../../../modules/designer/backend/net-identity/state-store";
import { seqOf } from "../../../modules/designer/backend/net-identity/types";
import { designHeads, pcbEntities, sessionHistories } from "../../../modules/designer/backend/schema";
import {
  MIGRATION_FIXTURES, MIGRATION_TS, migrationFixture, patchEntity, payloads, rawDatabase,
} from "./helpers/net-identity-migration-fixture";

describe("atomic legacy identity migration", () => {
  test("F1 binds every occurrence, clears auto hint and keeps named provenance", () => {
    const fixture = migrationFixture();
    try {
      const report = fixture.migrate();
      expect(report).toMatchObject({ netsAllocated: 3, historiesArchived: 1, boardSettings: "migrated", references: { quarantined: {} } });
      expect(report.revisionBefore).toBe(fixture.input.payload.revision);
      expect(report.revisionAfter).toBe(report.revisionBefore + 1);
      expect(report.references.bound.autoNameHint).toBe(1);
      expect(report.references.bound.nameHint).toBe(1);
      expect(Object.values(report.references.bound).reduce((sum, value) => sum + value, 0)).toBe(report.references.total);
      const zones = payloads(fixture, "zone");
      expect(zones.find((row) => row.name === "Unnamed UI zone")!.netName).toBeNull();
      expect(zones.find((row) => row.name === "GND plane")!.netName).toBe("GND");
      expect(readNetIdentityQuarantine(fixture.db, fixture.designId)).toEqual([]);
      expect(readNetIdentityState(fixture.db, fixture.designId)!.provenance.migration).toEqual(report);
      expect(fixture.db.select().from(sessionHistories).all()).toEqual([]);
      expect(JSON.parse(readNetIdentityBackup(fixture.db, fixture.designId)!.payloadJson)).toEqual(fixture.input.payload);
    } finally { fixture.sqlite.close(); }
  });

  test("F2 stale copper binds by contact while stale rule declarations stay quarantined", () => {
    const fixture = migrationFixture("f2-t132-stale");
    try {
      const report = fixture.migrate();
      expect(report.references.bound.contact).toBe(1);
      expect(report.references.quarantined.stale_root).toBe(4);
      const rows = readNetIdentityQuarantine(fixture.db, fixture.designId).filter((row) => row.refKind !== "zone");
      expect(new Set(rows.map((row) => row.refKind))).toEqual(new Set(["net_class_assignment", "length_group", "diff_pair", "drc_rule"]));
      expect(rows.every((row) => row.reason === "stale_root" && row.suggestedNetId !== null)).toBe(true);
    } finally { fixture.sqlite.close(); }
  });

  test("F3 binds case variants but retains unknown and ambiguous hints", () => {
    const fixture = migrationFixture("f3-name-hints");
    try {
      const report = fixture.migrate();
      expect(report.references.quarantined.unknown_name).toBe(1);
      expect(report.references.quarantined.ambiguous_name).toBe(2);
      const traces = payloads(fixture, "trace");
      expect(traces.find((row) => row.netName === "VCC")!.netId).toBe(traces.find((row) => row.netName === "vcc")!.netId);
      expect(traces.find((row) => row.netName === "UNKNOWN_SUPPLY")!.netId).toBeNull();
      expect(traces.find((row) => row.netName === "Net_1")!.netId).toBeNull();
    } finally { fixture.sqlite.close(); }
  });

  test("F9 proves four stitching vias by real pour", () => {
    const fixture = migrationFixture("f9-pour-only-gnd");
    try {
      const report = fixture.migrate();
      expect(report.references.bound.rootAndPour).toBe(4);
      expect(report.references.quarantined).toEqual({});
      expect(new Set(payloads(fixture, "via").map((row) => row.netId)).size).toBe(1);
    } finally { fixture.sqlite.close(); }
  });

  const stages: MigrationStage[] = ["backup", "fill", "derive", "evidence", "rewrite", "quarantine", "histories", "state"];
  test.each(stages)("fault after %s rolls back every raw table", (stage) => {
    const fixture = migrationFixture("f2-t132-stale");
    try {
      patchEntity(fixture, "board_settings", (raw) => {
        (raw.viewState as Record<string, unknown>).copperFillLayers = ["F.Cu"];
      });
      const before = rawDatabase(fixture.sqlite), fault = new Error(`fault:${stage}`);
      try {
        fixture.migrate((at) => {
          if (at === "quarantine") expect(readNetIdentityQuarantine(fixture.db, fixture.designId).length).toBeGreaterThan(0);
          if (at === stage) throw fault;
        });
        throw new Error("expected migration failure");
      } catch (error) {
        expect(error).toBeInstanceOf(NetIdentityMigrationError);
        expect((error as NetIdentityMigrationError).stage).toBe(stage);
        expect((error as Error).cause).toBe(fault);
      }
      expect(rawDatabase(fixture.sqlite)).toBe(before);
    } finally { fixture.sqlite.close(); }
  });

  test.each(MIGRATION_FIXTURES)("%s migration is byte-reproducible in two databases", (name) => {
    const first = migrationFixture(name), second = migrationFixture(name);
    try {
      expect(first.migrate()).toEqual(second.migrate());
      expect(rawDatabase(first.sqlite)).toBe(rawDatabase(second.sqlite));
    } finally { first.sqlite.close(); second.sqlite.close(); }
  });

  test("legacy fill uses deterministic IDs and backup predates fill", () => {
    const first = migrationFixture(), second = migrationFixture();
    try {
      for (const fixture of [first, second]) patchEntity(fixture, "board_settings", (raw) => {
        (raw.viewState as Record<string, unknown>).copperFillLayers = ["F.Cu"];
      });
      first.migrate(); second.migrate();
      expect(rawDatabase(first.sqlite)).toBe(rawDatabase(second.sqlite));
      const row = first.rows().find((entry) => entry.id === legacyFillRowId(first.designId, "board:F.Cu"));
      expect(row?.kind).toBe("zone");
      expect(JSON.parse(row!.payloadJson).netName).toBe("GND");
      const backup = JSON.parse(readNetIdentityBackup(first.db, first.designId)!.payloadJson);
      expect(backup.pcbEntities.some((entry: { id: string }) => entry.id === row!.id)).toBe(false);
      expect(backup.pcbEntities.find((entry: { kind: string }) => entry.kind === "board_settings").payloadJson).toContain("copperFillLayers");
    } finally { first.sqlite.close(); second.sqlite.close(); }
  });

  test("restore/remigrate keeps lifetime watermark and retired records", () => {
    const fixture = migrationFixture();
    try {
      fixture.migrate();
      const original = readNetIdentityState(fixture.db, fixture.designId)!;
      restoreLegacyNetIdentity(fixture.db, fixture.designId, { timestamp: MIGRATION_TS, confirmDiscardRevisions: false });
      const retired = readNetIdentityRetired(fixture.db, fixture.designId);
      const report = fixture.migrate(), next = readNetIdentityState(fixture.db, fixture.designId)!;
      expect(Math.min(...next.active.map((row) => seqOf(row.id)!))).toBeGreaterThan(Math.max(...original.active.map((row) => seqOf(row.id)!)));
      expect(readNetIdentityRetired(fixture.db, fixture.designId)).toEqual(retired);
      expect(report.revisionBefore).toBe(original.provenance.migration!.revisionAfter + 1);
      expect(fixture.db.select().from(designHeads).where(eq(designHeads.id, fixture.designId)).get()!.revision).toBe(report.revisionAfter);
    } finally { fixture.sqlite.close(); }
  });
});
