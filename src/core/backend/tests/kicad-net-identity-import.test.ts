import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { KicadProjectImportWarning, PcbZone } from "../../../sdks/designer";
import { resolveImportedNetHints, resolvePerNetClassAssignments } from "../../../modules/designer/backend/import/kicad-project/net-references";
import type { BoundNet } from "../../../modules/designer/backend/net-identity/bind";
import { readNetIdentityQuarantine, readRawNetIdentityState, writeNetIdentityQuarantine, type NetIdentityDb } from "../../../modules/designer/backend/net-identity/state-store";
import { initializeNetIdentity } from "../../../modules/designer/backend/net-identity/sync";
import { designNetSalt, formatDurableNetId } from "../../../modules/designer/backend/net-identity/types";
import { commandLog, designHeads, netIdentityQuarantine, pcbEntities, schematicLabels } from "../../../modules/designer/backend/schema";
import { board, trace, via } from "./helpers/drc-fixtures";
import { migrationFixture, rawDatabase, type MigrationFixture } from "./helpers/net-identity-migration-fixture";

const CREATED = "2026-10-22T00:00:00.000Z", UPDATED = "2026-10-22T01:00:00.000Z";
let fixture: MigrationFixture, warnings: KicadProjectImportWarning[];
beforeEach(() => {
  fixture = migrationFixture();
  fixture.db.delete(pcbEntities).where(eq(pcbEntities.designId, fixture.designId)).run();
  warnings = [];
});
afterEach(() => fixture.sqlite.close());

function id(sequence: number, designId = fixture.designId): string {
  return formatDurableNetId(designNetSalt(designId), sequence);
}
function net(sequence: number, name: string, extra: Partial<BoundNet> = {}): BoundNet {
  return { id: id(sequence), name, autoNamed: false, nameSource: "label", legacyRoot: `root:${sequence}`,
    pinIds: [], wireIds: [], labelIds: [], primitiveIds: [], ...extra };
}
function zone(payloadId: string, netName: string | null, enabled = true): PcbZone {
  return { id: payloadId, name: null, enabled, lockedAt: null, layer: "F.Cu", netId: null, netName,
    region: { kind: "polygon", pointsMm: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] }, priority: 0 };
}
function payload(kind: "trace" | "via" | "zone", payloadId: string, netName: string | null): Record<string, unknown> {
  return kind === "trace" ? { ...trace(payloadId, null, [[0, 0], [1, 0]]), netName }
    : kind === "via" ? { ...via(payloadId), netName } : { ...zone(payloadId, netName) };
}
function seed(kind: string, value: unknown, rowId = kind, designId = fixture.designId, db: NetIdentityDb = fixture.db): void {
  db.insert(pcbEntities).values({ id: rowId, designId, kind, payloadJson: JSON.stringify(value), createdAt: CREATED, updatedAt: CREATED }).run();
}
function stored(rowId: string) {
  return fixture.db.select().from(pcbEntities).where(eq(pcbEntities.id, rowId)).get()!;
}
function resolve(nets: readonly BoundNet[]): void {
  fixture.db.transaction((tx) => resolveImportedNetHints(tx as NetIdentityDb, fixture.designId, nets, warnings, UPDATED));
}

describe("exact named-only imported class assignments", () => {
  test("exact names bind, case and whitespace mismatches warn, class casing remains compatible", () => {
    const nets = [net(1, "SIG"), net(2, "Other")], settings = board();
    const before = JSON.stringify({ nets, settings });
    const result = resolvePerNetClassAssignments(nets, settings, { SIG: "pOwEr", sig: "Power", " SIG ": "Power", Other: "missing" }, warnings);
    expect(result).toEqual({ [id(1)]: settings.netClasses.find((entry) => entry.name.toLowerCase() === "power")!.id });
    expect(warnings.map((warning) => warning.code)).toEqual([
      "kicad_netclass_assignment_unknown_net", "kicad_netclass_assignment_unknown_net", "kicad_netclass_unknown",
    ]);
    expect(warnings[0]!.message).toContain("'sig'"); expect(warnings[1]!.message).toContain("' SIG '");
    expect(JSON.stringify({ nets, settings })).toBe(before);
  });

  test("generated names are ineligible; explicit literal Net_5 and overrides remain eligible", () => {
    const nets = [net(1, "Net_1", { autoNamed: true, nameSource: "auto" }), net(5, "Net_5"),
      net(6, "manual", { nameSource: "override" }), net(7, "bad-marker", { nameSource: "auto" }),
      net(8, "other-bad-marker", { autoNamed: true })];
    const result = resolvePerNetClassAssignments(nets, board(), {
      Net_1: "Default", Net_5: "Default", manual: "Default", "bad-marker": "Default", "other-bad-marker": "Default",
    }, warnings);
    expect(Object.keys(result)).toEqual([id(5), id(6)]);
    expect(warnings.map((warning) => warning.code)).toEqual(Array(3).fill("kicad_netclass_assignment_unknown_net"));
  });

  test("duplicate eligible display names refuse assignments instead of picking array order", () => {
    const result = resolvePerNetClassAssignments([net(9, "same"), net(2, "same")], board(), { same: "Power" }, warnings);
    expect(result).toEqual({});
    expect(warnings.map((warning) => warning.code)).toEqual(["kicad_netclass_assignment_ambiguous_net"]);
  });
});

describe("persisted imported copper hints", () => {
  test.each(["trace", "via", "zone"] as const)("%s binds exact named hint while preserving raw fields and provenance", (kind) => {
    const original = { ...payload(kind, "entity", "SIG"), future: { keep: [1, "x"] } };
    seed(kind, original);
    const state = readRawNetIdentityState(fixture.db, fixture.designId);
    resolve([net(3, "SIG")]);
    const row = stored(kind);
    expect(JSON.parse(row.payloadJson)).toEqual({ ...original, netId: id(3) });
    expect(row.createdAt).toBe(CREATED); expect(row.updatedAt).toBe(UPDATED);
    expect(warnings).toEqual([]); expect(readNetIdentityQuarantine(fixture.db, fixture.designId)).toEqual([]);
    expect(readRawNetIdentityState(fixture.db, fixture.designId)).toEqual(state);
    expect(fixture.db.select().from(pcbEntities).all()).toHaveLength(1);
  });

  test.each(["sig", " SIG ", "Net-(U1-Pad1)"])("mismatched hint %s remains byte-exact with immutable unknown provenance", (hint) => {
    seed("trace", { ...payload("trace", "trace", hint), unknown: true });
    const before = stored("trace");
    resolve([net(1, "SIG")]);
    expect(stored("trace")).toEqual(before);
    expect(readNetIdentityQuarantine(fixture.db, fixture.designId)).toEqual([{
      designId: fixture.designId, refKind: "trace", refId: "trace", legacyValue: hint,
      reason: "unknown_name", candidates: [], suggestedNetId: null, createdAt: UPDATED,
    }]);
    expect(warnings.map((warning) => warning.code)).toEqual(["kicad_net_unresolved"]);
    const snapshot = rawDatabase(fixture.sqlite);
    expect(() => resolve([net(1, "SIG")])).toThrow();
    expect(rawDatabase(fixture.sqlite)).toBe(snapshot);
  });

  test("all copper kinds refuse ambiguous hints with sorted unique candidate ids", () => {
    for (const kind of ["trace", "via", "zone"] as const) seed(kind, payload(kind, kind, "SIG"));
    const before = fixture.db.select().from(pcbEntities).all();
    resolve([net(9, "SIG"), net(2, "SIG"), net(9, "SIG")]);
    expect(fixture.db.select().from(pcbEntities).all()).toEqual(before);
    expect(readNetIdentityQuarantine(fixture.db, fixture.designId).map((row) => ({
      kind: row.refKind, candidates: row.candidates, reason: row.reason, suggestion: row.suggestedNetId,
    }))).toEqual((["trace", "via", "zone"] as const).map((kind) => ({ kind, candidates: [id(2), id(9)], reason: "ambiguous_name", suggestion: null })));
    expect(warnings.map((warning) => warning.code)).toEqual(Array(3).fill("kicad_net_ambiguous"));
  });

  test("auto names never bind, but literal named Net_N does", () => {
    seed("trace", payload("trace", "auto", "Net_1")); seed("via", payload("via", "named", "Net_5"));
    resolve([net(1, "Net_1", { autoNamed: true, nameSource: "auto" }), net(5, "Net_5")]);
    expect(JSON.parse(stored("trace").payloadJson).netId).toBeNull();
    expect(JSON.parse(stored("via").payloadJson).netId).toBe(id(5));
    expect(readNetIdentityQuarantine(fixture.db, fixture.designId)[0]!.legacyValue).toBe("Net_1");
  });

  test("disabled zones bind without being enabled; blank names and existing ids stay untouched", () => {
    seed("zone", { ...zone("disabled", "SIG", false), future: 42 }, "disabled");
    seed("zone", zone("disabled-unknown", "missing", false), "disabled-unknown");
    seed("trace", { ...payload("trace", "existing", "SIG"), netId: "old-id" }, "existing");
    for (const [index, hint] of [null, "", " \t "].entries()) seed("via", payload("via", `blank-${index}`, hint), `blank-${index}`);
    const before = new Map(fixture.db.select().from(pcbEntities).all().map((row) => [row.id, row]));
    resolve([net(1, "SIG")]);
    expect(JSON.parse(stored("disabled").payloadJson)).toMatchObject({ enabled: false, netId: id(1), netName: "SIG", future: 42 });
    for (const rowId of ["existing", "blank-0", "blank-1", "blank-2", "disabled-unknown"]) expect(stored(rowId)).toEqual(before.get(rowId)!);
    expect(readNetIdentityQuarantine(fixture.db, fixture.designId)).toMatchObject([{ refKind: "zone", refId: "disabled-unknown", legacyValue: "missing" }]);
  });

  test("another design's malformed copper is not inspected or modified", () => {
    fixture.db.insert(designHeads).values({ id: "other", name: "Other", revision: 0, createdAt: CREATED, updatedAt: CREATED }).run();
    seed("trace", { malformed: true }, "other-row", "other");
    const before = rawDatabase(fixture.sqlite);
    resolve([net(1, "SIG")]);
    expect(rawDatabase(fixture.sqlite)).toBe(before);
  });
});

describe("malformed imported evidence and transaction rollback", () => {
  test.each([
    "{broken", "null", "[]",
    JSON.stringify({ ...trace("bad", null, [[0, 0], [1, 0]]), id: 3 }),
    JSON.stringify({ ...trace("bad", null, [[0, 0], [1, 0]]), netId: 3 }),
    JSON.stringify({ ...trace("bad", null, [[0, 0], [1, 0]]), netName: 3 }),
    JSON.stringify({ ...trace("bad", null, [[0, 0], [1, 0]]), widthMm: "bad" }),
  ])("invalid raw row fails without silently losing evidence: %s", (payloadJson) => {
    seed("trace", payload("trace", "valid", "SIG"), "a-valid");
    fixture.db.insert(pcbEntities).values({ id: "z-invalid", designId: fixture.designId, kind: "trace", payloadJson, createdAt: CREATED, updatedAt: CREATED }).run();
    const before = rawDatabase(fixture.sqlite);
    expect(() => resolve([net(1, "SIG")])).toThrow();
    expect(rawDatabase(fixture.sqlite)).toBe(before);
    expect(warnings).toEqual([]);
  });

  test("duplicate payload ids fail before any row is changed", () => {
    seed("trace", payload("trace", "duplicate", "SIG")); seed("via", payload("via", "duplicate", "SIG"));
    const before = rawDatabase(fixture.sqlite);
    expect(() => resolve([net(1, "SIG")])).toThrow("duplicate imported payload identity");
    expect(rawDatabase(fixture.sqlite)).toBe(before);
  });

  test("late immutable-quarantine failure rolls back earlier bindings and quarantine inserts", () => {
    seed("trace", payload("trace", "matched", "SIG")); seed("via", payload("via", "unknown", "missing")); seed("zone", zone("collision", "missing"));
    writeNetIdentityQuarantine(fixture.db, { designId: fixture.designId, refKind: "zone", refId: "collision", legacyValue: "missing",
      reason: "unknown_name", candidates: [], suggestedNetId: null, createdAt: CREATED });
    const before = rawDatabase(fixture.sqlite);
    expect(() => resolve([net(1, "SIG")])).toThrow();
    expect(rawDatabase(fixture.sqlite)).toBe(before);
    expect(fixture.db.select().from(netIdentityQuarantine).all()).toHaveLength(1);
  });

  test("caller rollback covers new head, schematic, identity, copper, quarantine and command log", () => {
    const before = rawDatabase(fixture.sqlite), designId = "fresh-import";
    expect(() => fixture.db.transaction((raw) => {
      const tx = raw as NetIdentityDb;
      tx.insert(designHeads).values({ id: designId, name: "New", revision: 0, createdAt: CREATED, updatedAt: CREATED }).run();
      tx.insert(schematicLabels).values({ id: "new-label", designId, text: "SIG", xNm: 0, yNm: 0, createdAt: CREATED, updatedAt: CREATED }).run();
      const nets = initializeNetIdentity(tx, designId, "kicad-import", CREATED);
      seed("trace", payload("trace", "new-trace", "SIG"), "new-trace", designId, tx);
      seed("via", payload("via", "new-via", "missing"), "new-via", designId, tx);
      resolveImportedNetHints(tx, designId, nets, [], UPDATED);
      tx.insert(commandLog).values({ commandId: "new-command", designId, sessionId: "import", commandType: "import_kicad_project",
        commandJson: "{}", resultJson: "{}", issuedAt: 0, appliedRevision: 0, createdAt: CREATED }).run();
      throw new Error("post-reference failure");
    })).toThrow("post-reference failure");
    expect(rawDatabase(fixture.sqlite)).toBe(before);
  });
});
