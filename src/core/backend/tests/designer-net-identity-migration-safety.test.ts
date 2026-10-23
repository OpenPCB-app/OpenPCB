import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { captureNetIdentityBackup } from "../../../modules/designer/backend/net-identity/backup";
import { NetIdentityMigrationError, migrateDesignNetIdentity, type MigrationStage } from "../../../modules/designer/backend/net-identity/migrate";
import {
  readNetIdentityQuarantine, readNetIdentityState, writeNetIdentityQuarantine, writeNetIdentityState, type NetIdentityDb,
} from "../../../modules/designer/backend/net-identity/state-store";
import { designNetSalt, formatDurableNetId } from "../../../modules/designer/backend/net-identity/types";
import {
  designHeads, pcbEntities, schematicLabels, schematicParts, schematicPins, schematicPrimitives, schematicWires,
} from "../../../modules/designer/backend/schema";
import {
  MIGRATION_TS, migrationFixture, patchEntity, payloads, rawDatabase, type MigrationFixture,
} from "./helpers/net-identity-migration-fixture";

function refuses(fixture: MigrationFixture, stage?: MigrationStage, detail?: string): void {
  const before = rawDatabase(fixture.sqlite);
  let caught: unknown;
  try { fixture.migrate(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(NetIdentityMigrationError);
  if (stage) expect((caught as NetIdentityMigrationError).stage).toBe(stage);
  if (detail) expect((caught as Error).message).toContain(detail);
  expect(rawDatabase(fixture.sqlite)).toBe(before);
}

function setPayload(fixture: MigrationFixture, rowId: string, payloadJson: string): void {
  fixture.db.update(pcbEntities).set({ payloadJson }).where(eq(pcbEntities.id, rowId)).run();
}

function clearSchematic(fixture: MigrationFixture): void {
  for (const table of [schematicWires, schematicPins, schematicLabels, schematicPrimitives, schematicParts]) {
    fixture.db.delete(table).where(eq(table.designId, fixture.designId)).run();
  }
}

describe("migration refuses unsafe source without writes", () => {
  test.each([
    ["bad intermediate point", '[{"x":0,"y":0},{"x":"bad","y":10},{"x":100,"y":0}]'],
    ["non-array wire", '{}'], ["malformed wire JSON", 'not-json'],
    ["nonfinite wire point", '[{"x":1e999,"y":0}]'],
  ])("%s cannot recover into connectivity", (_name, pointsJson) => {
    const fixture = migrationFixture();
    try {
      fixture.db.update(schematicWires).set({ pointsJson }).where(eq(schematicWires.id, fixture.input.payload.schematic.wires[0]!.id)).run();
      refuses(fixture, "derive");
    } finally { fixture.sqlite.close(); }
  });

  test.each([
    ["unknown primitive", "future_kind", '{}'], ["bad rail text", "pwr", '{"railText":8}'],
    ["bad portal text", "net_portal", '{"portalText":null}'], ["malformed naming JSON", "pwr", '{bad'],
    ["array naming JSON", "net_portal", '[]'],
  ])("%s cannot become authoritative naming", (_name, kind, payloadJson) => {
    const fixture = migrationFixture();
    try {
      fixture.db.update(schematicPrimitives).set({ kind, payloadJson }).where(eq(schematicPrimitives.id, fixture.input.payload.schematic.primitives[0]!.id)).run();
      refuses(fixture, "derive");
    } finally { fixture.sqlite.close(); }
  });

  test("empty wires and absent naming text keep existing semantics; unknown point keys survive", () => {
    const fixture = migrationFixture();
    try {
      const wire = fixture.input.payload.schematic.wires[0]!;
      fixture.db.update(schematicWires).set({ pointsJson: "[]" }).where(eq(schematicWires.id, wire.id)).run();
      fixture.db.update(schematicPrimitives).set({ payloadJson: '{}' }).where(eq(schematicPrimitives.kind, "pwr")).run();
      const other = fixture.input.payload.schematic.wires[1]!;
      const points = (JSON.parse(other.pointsJson) as Array<{ x: number; y: number }>).map((point) => ({ ...point, future: { preserve: true } }));
      fixture.db.update(schematicWires).set({ pointsJson: JSON.stringify(points) }).where(eq(schematicWires.id, other.id)).run();
      fixture.migrate();
      expect(fixture.db.select().from(schematicWires).where(eq(schematicWires.id, other.id)).get()!.pointsJson).toBe(JSON.stringify(points));
    } finally { fixture.sqlite.close(); }
  });

  test.each([
    ["malformed physical JSON", "trace", "not-json"], ["invalid declared netId", "trace", { netId: 42 }],
    ["invalid declared netName", "via", { netName: {} }],
  ] as const)("%s refuses", (_name, kind, mutation) => {
    const fixture = migrationFixture();
    try {
      if (typeof mutation === "string") setPayload(fixture, fixture.rows().find((row) => row.kind === kind)!.id, mutation);
      else patchEntity(fixture, kind, (raw) => Object.assign(raw, mutation));
      refuses(fixture, "fill");
    } finally { fixture.sqlite.close(); }
  });

  test.each(["unknown physical kind", "duplicate board", "duplicate payload identity"])("%s refuses", (caseName) => {
    const fixture = migrationFixture();
    try {
      const original = fixture.rows().find((row) => row.kind === (caseName === "duplicate board" ? "board_settings" : "trace"))!;
      fixture.db.insert(pcbEntities).values({ ...original, id: "extra-row", kind: caseName === "unknown physical kind" ? "future_copper" : original.kind }).run();
      refuses(fixture, "fill");
    } finally { fixture.sqlite.close(); }
  });

  test.each(["", " \n "])("blank quarantined provenance %j refuses before rewrite", (netId) => {
    const fixture = migrationFixture();
    try {
      patchEntity(fixture, "trace", (raw) => {
        raw.netId = netId; raw.pointsNm = [{ x: 80_000_000, y: 70_000_000 }, { x: 81_000_000, y: 70_000_000 }];
      });
      refuses(fixture, "rewrite", "must be a non-blank string");
    } finally { fixture.sqlite.close(); }
  });

  test("nc collision cannot turn an unproven quarantine into a bound reference", () => {
    const fixture = migrationFixture();
    try {
      fixture.db.delete(schematicWires).run(); fixture.db.delete(schematicPrimitives).run();
      patchEntity(fixture, "trace", (raw) => {
        raw.netId = `nc:${fixture.input.payload.schematic.pins[0]!.id}`;
        raw.pointsNm = [{ x: 80_000_000, y: 70_000_000 }, { x: 81_000_000, y: 70_000_000 }];
      });
      refuses(fixture, "rewrite", "unproven reference collides");
    } finally { fixture.sqlite.close(); }
  });

  test("skipped recovered board references cannot collide with newly live lone IDs", () => {
    const fixture = migrationFixture();
    try {
      fixture.db.delete(schematicWires).run(); fixture.db.delete(schematicLabels).run(); fixture.db.delete(schematicPrimitives).run();
      for (const row of fixture.rows()) if (row.kind !== "board_settings") fixture.db.delete(pcbEntities).where(eq(pcbEntities.id, row.id)).run();
      patchEntity(fixture, "board_settings", (raw) => {
        raw.outline = { kind: "future" };
        raw.perNetClassAssignments = { [`nc:${fixture.input.payload.schematic.pins[0]!.id}`]: "default" };
        raw.lengthMatchGroups = []; raw.diffPairs = []; raw.drcRules = [];
      });
      refuses(fixture, "rewrite", "skipped board reference collides");
    } finally { fixture.sqlite.close(); }
  });

  test("old durable IDs found only in raw copper remain inactive after migration", () => {
    const fixture = migrationFixture();
    try {
      const oldId = formatDurableNetId(designNetSalt(fixture.designId), 1);
      const rowId = patchEntity(fixture, "trace", (raw) => {
        raw.netId = oldId; raw.pointsNm = [{ x: 80_000_000, y: 70_000_000 }, { x: 81_000_000, y: 70_000_000 }];
      });
      fixture.migrate();
      const state = readNetIdentityState(fixture.db, fixture.designId)!;
      expect(state.active.some((row) => row.id === oldId)).toBe(false);
      expect(state.nextSeq).toBe(5);
      expect(JSON.parse(fixture.rows().find((row) => row.id === rowId)!.payloadJson).netId).toBe(oldId);
      expect(readNetIdentityQuarantine(fixture.db, fixture.designId).some((row) => row.legacyValue === oldId)).toBe(true);
    } finally { fixture.sqlite.close(); }
  });

  test("active state direct call refuses instead of rerunning migration", () => {
    const fixture = migrationFixture();
    try { fixture.migrate(); refuses(fixture, "backup", "already active"); }
    finally { fixture.sqlite.close(); }
  });

  test("failed state retries above its watermark, but nonactive records cannot be silently retired", () => {
    const fixture = migrationFixture();
    try {
      writeNetIdentityState(fixture.db, {
        designId: fixture.designId, schemaVersion: 1, status: "migration_failed", active: [], nextSeq: 70,
        provenance: { origin: "legacy-migration", createdAt: MIGRATION_TS, migratorVersion: 1 },
        lastError: "previous attempt", updatedAt: MIGRATION_TS,
      });
      fixture.migrate();
      const state = readNetIdentityState(fixture.db, fixture.designId)!;
      expect(state.nextSeq).toBe(73); expect(state.lastError).toBeNull();
      writeNetIdentityState(fixture.db, { ...state, status: "legacy_restored" });
      refuses(fixture, "backup", "nonactive state contains active identities");
    } finally { fixture.sqlite.close(); }
  });

  test("real SQLite failure preserves original code through cause and rolls back", () => {
    const fixture = migrationFixture();
    try {
      const before = rawDatabase(fixture.sqlite);
      let caught: unknown;
      try {
        fixture.migrate((stage) => {
          if (stage === "state") fixture.sqlite.query("INSERT INTO designer_design_heads (id,name,revision,created_at,updated_at) VALUES (?,?,?,?,?)")
            .run(fixture.designId, "collision", 0, MIGRATION_TS, MIGRATION_TS);
        });
      } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(NetIdentityMigrationError);
      expect((caught as NetIdentityMigrationError).stage).toBe("state");
      expect(((caught as Error).cause as { code: string }).code).toBe("SQLITE_CONSTRAINT_PRIMARYKEY");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
    } finally { fixture.sqlite.close(); }
  });

  test("malformed footprint uses canonical parser failure and rolls back", () => {
    const fixture = migrationFixture();
    try {
      patchEntity(fixture, "placement", (raw) => { raw.footprint = { preview: { pads: { malformed: true } } }; });
      refuses(fixture, "evidence");
    } finally { fixture.sqlite.close(); }
  });

  test("touched duplicate raw rule identities refuse exact patching", () => {
    const fixture = migrationFixture();
    try {
      patchEntity(fixture, "board_settings", (raw) => {
        const group = (raw.lengthMatchGroups as unknown[])[0];
        (raw.lengthMatchGroups as unknown[]).push(group);
      });
      refuses(fixture, "rewrite", "unique");
    } finally { fixture.sqlite.close(); }
  });

  test("report counts repeated occurrences while quarantine stores one immutable provenance row", () => {
    const fixture = migrationFixture();
    try {
      patchEntity(fixture, "board_settings", (raw) => {
        (raw.lengthMatchGroups as unknown[]).push({
          id: "repeat", name: "Repeated unresolved root", netIds: ["foreign", "foreign"], target: { kind: "longest" }, toleranceMm: 0,
        });
      });
      const report = fixture.migrate();
      expect(report.references.quarantined.no_evidence).toBe(2);
      expect(readNetIdentityQuarantine(fixture.db, fixture.designId).filter((row) => row.refId === "repeat")).toHaveLength(1);
      expect((payloads(fixture, "board_settings")[0]!.lengthMatchGroups as Record<string, unknown>[]).find((row) => row.id === "repeat")!.netIds)
        .toEqual(["foreign", "foreign"]);
    } finally { fixture.sqlite.close(); }
  });

  test("preexisting quarantine evidence is never erased on retry", () => {
    const fixture = migrationFixture();
    try {
      writeNetIdentityQuarantine(fixture.db, {
        designId: fixture.designId, refKind: "trace", refId: "previous", legacyValue: "previous-root",
        reason: "no_evidence", candidates: [], suggestedNetId: null, createdAt: MIGRATION_TS,
      });
      refuses(fixture, "backup", "preexisting quarantine evidence");
    } finally { fixture.sqlite.close(); }
  });

  test("missing head and unsafe revision fail before backup writes", () => {
    const fixture = migrationFixture();
    try {
      const before = rawDatabase(fixture.sqlite);
      expect(() => fixture.db.transaction((tx) => migrateDesignNetIdentity(tx as NetIdentityDb, "missing", { timestamp: MIGRATION_TS })))
        .toThrow("no head");
      expect(rawDatabase(fixture.sqlite)).toBe(before);
      fixture.db.update(designHeads).set({ revision: Number.MAX_SAFE_INTEGER }).where(eq(designHeads.id, fixture.designId)).run();
      refuses(fixture, "backup", "safe integer");
    } finally { fixture.sqlite.close(); }
  });
});

describe("migration conservative evidence and raw preservation", () => {
  test("root alone is quarantined without moving raw copper", () => {
    const fixture = migrationFixture();
    try {
      const id = patchEntity(fixture, "trace", (raw) => {
        raw.pointsNm = [{ x: 80_000_000, y: 70_000_000 }, { x: 81_000_000, y: 70_000_000 }];
      });
      const before = fixture.rows().find((row) => row.id === id)!;
      fixture.migrate();
      expect(fixture.rows().find((row) => row.id === id)).toEqual(before);
      expect(readNetIdentityQuarantine(fixture.db, fixture.designId).find((row) => row.refId === id)!.reason).toBe("root_only");
    } finally { fixture.sqlite.close(); }
  });

  test("two schematic nets touching one copper island cause short quarantine", () => {
    const fixture = migrationFixture();
    try {
      const id = patchEntity(fixture, "trace", (raw) => {
        raw.pointsNm = [{ x: 14_225_000, y: 20_000_000 }, { x: 35_775_000, y: 20_000_000 }];
      });
      fixture.migrate();
      const row = readNetIdentityQuarantine(fixture.db, fixture.designId).find((entry) => entry.refId === id)!;
      expect(row.reason).toBe("short"); expect(row.candidates).toHaveLength(2);
    } finally { fixture.sqlite.close(); }
  });

  test("one root reused across separate islands produces conflict, never a false physical short", () => {
    const fixture = migrationFixture();
    try {
      const traces = fixture.rows().filter((row) => row.kind === "trace");
      const source = JSON.parse(traces[0]!.payloadJson) as Record<string, unknown>;
      const other = traces.find((row) => (JSON.parse(row.payloadJson) as Record<string, unknown>).netId !== source.netId)!;
      setPayload(fixture, other.id, JSON.stringify({ ...JSON.parse(other.payloadJson), netId: source.netId }));
      fixture.migrate();
      const rows = readNetIdentityQuarantine(fixture.db, fixture.designId);
      expect(rows.find((row) => row.refId === other.id)!.reason).toBe("conflict");
      expect(rows.every((row) => row.reason !== "short")).toBe(true);
    } finally { fixture.sqlite.close(); }
  });

  test("ambiguous pad labels cannot supply last-wins contact proof", () => {
    const fixture = migrationFixture();
    try {
      const pin = fixture.input.payload.schematic.pins.find((row) => row.worldXNm === 0)!;
      const pins = fixture.input.payload.schematic.pins.filter((row) => row.partId === pin.partId);
      fixture.db.update(schematicPins).set({ number: pins[0]!.number }).where(eq(schematicPins.partId, pin.partId)).run();
      for (const row of fixture.input.payload.schematic.wires) if (pins.some((entry) => entry.id === row.sourcePinId)) {
        fixture.db.delete(schematicWires).where(eq(schematicWires.id, row.id)).run();
      }
      fixture.migrate();
      const trace = fixture.input.payload.pcbEntities.find((row) => row.kind === "trace" && JSON.parse(row.payloadJson).netId === "pt:0:-3810000")!;
      const quarantined = readNetIdentityQuarantine(fixture.db, fixture.designId).find((row) => row.refId === trace.id)!;
      expect(quarantined.reason).toBe("root_only");
      expect(fixture.rows().find((row) => row.id === trace.id)).toEqual(trace);
    } finally { fixture.sqlite.close(); }
  });

  test("other normalized physical fields exclude contact proof instead of refusing", () => {
    const fixture = migrationFixture();
    try {
      const id = patchEntity(fixture, "via", (raw) => { raw.protection = "future_mode"; });
      const before = fixture.rows().find((row) => row.id === id)!;
      fixture.migrate();
      expect(fixture.rows().find((row) => row.id === id)).toEqual(before);
      expect(readNetIdentityQuarantine(fixture.db, fixture.designId).find((row) => row.refId === id)!.reason).toBe("root_only");
    } finally { fixture.sqlite.close(); }
  });

  test("unparseable required board data remains byte-exact; trusted stackup still permits direct proof", () => {
    const fixture = migrationFixture();
    try {
      const id = patchEntity(fixture, "board_settings", (raw) => { raw.outline = null; });
      const before = fixture.rows().find((row) => row.id === id)!;
      const report = fixture.migrate();
      expect(report.boardSettings).toBe("unparseable");
      expect(report.references.bound.rootAndContact).toBe(4);
      expect(fixture.rows().find((row) => row.id === id)).toEqual(before);
      expect(readNetIdentityQuarantine(fixture.db, fixture.designId).every((row) => ["trace", "via", "zone"].includes(row.refKind))).toBe(true);
    } finally { fixture.sqlite.close(); }
  });

  test("empty design migrates without manufacturing a board row", () => {
    const fixture = migrationFixture();
    try {
      fixture.db.delete(pcbEntities).run(); clearSchematic(fixture);
      const report = fixture.migrate();
      expect(report).toMatchObject({ netsAllocated: 0, boardSettings: "absent", references: { total: 0 } });
      expect(fixture.rows()).toEqual([]);
      expect(readNetIdentityState(fixture.db, fixture.designId)!.active).toEqual([]);
    } finally { fixture.sqlite.close(); }
  });

  test("raw unknown metadata, rows, geometry, intent, and unchanged bytes survive targeted writes", () => {
    const fixture = migrationFixture();
    try {
      const traceId = patchEntity(fixture, "trace", (raw) => { raw.future = { nested: [1, "keep"] }; });
      patchEntity(fixture, "board_settings", (raw) => {
        raw.futureBlock = { mustSurvive: true };
        (raw.lengthMatchGroups as Record<string, unknown>[])[0]!.future = { keep: true };
        (raw.lengthMatchGroups as unknown[]).push({ futureRow: { keep: true } });
        const rule = (raw.drcRules as Record<string, unknown>[])[0]!;
        (rule.scopes as Record<string, unknown>[])[0]!.futureScope = "keep";
      });
      const before = fixture.rows(), traceBefore = JSON.parse(before.find((row) => row.id === traceId)!.payloadJson);
      const persistedSchematic = () => JSON.stringify((JSON.parse(
        captureNetIdentityBackup(fixture.db, fixture.designId, MIGRATION_TS).payloadJson,
      ) as { schematic: unknown }).schematic);
      const rawSchematic = persistedSchematic();
      fixture.migrate();
      const after = fixture.rows(), traceAfter = JSON.parse(after.find((row) => row.id === traceId)!.payloadJson);
      expect(traceAfter).toEqual({ ...traceBefore, netId: traceAfter.netId });
      expect(traceAfter.netId).not.toBe(traceBefore.netId);
      for (const old of before) {
        const next = after.find((row) => row.id === old.id)!;
        expect(next.createdAt).toBe(old.createdAt);
        if (old.kind === "placement") expect(next).toEqual(old);
      }
      const board = payloads(fixture, "board_settings")[0]!;
      expect(board.futureBlock).toEqual({ mustSurvive: true });
      expect((board.lengthMatchGroups as unknown[]).at(-1)).toEqual({ futureRow: { keep: true } });
      expect((board.lengthMatchGroups as Record<string, unknown>[])[0]!.future).toEqual({ keep: true });
      expect(((board.drcRules as Record<string, unknown>[])[0]!.scopes as Record<string, unknown>[])[0]!.futureScope).toBe("keep");
      expect(persistedSchematic()).toBe(rawSchematic);
    } finally { fixture.sqlite.close(); }
  });
});
