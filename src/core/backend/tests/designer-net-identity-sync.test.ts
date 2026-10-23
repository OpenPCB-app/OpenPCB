import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { bindNetIdentity } from "../../../modules/designer/backend/net-identity/bind";
import { createNetDependentsCensus } from "../../../modules/designer/backend/net-identity/census";
import { loadNetReferenceSource } from "../../../modules/designer/backend/net-identity/census-source";
import { resolveIdentityMode } from "../../../modules/designer/backend/net-identity/mode";
import { bindSchematicIdentity } from "../../../modules/designer/backend/net-identity/projection";
import { persistReplayIdentity, priorNetOwners } from "../../../modules/designer/backend/net-identity/replay";
import {
  initializeNetIdentity, isSchematicNeutralCommand, setNetDisplayOverride, syncNetIdentity,
} from "../../../modules/designer/backend/net-identity/sync";
import {
  readNetIdentityRetired, readNetIdentityState, writeNetIdentityRetired,
  writeNetIdentityState, type NetIdentityDb,
} from "../../../modules/designer/backend/net-identity/state-store";
import { designNetSalt, formatDurableNetId, NetIdentityStateInvalidError } from "../../../modules/designer/backend/net-identity/types";
import { loadSchematicSource } from "../../../modules/designer/backend/projection-read";
import { deriveNetComponents, deriveNetsAndJunctions } from "../../../modules/designer/backend/projection-world";
import { checkNetDiagnostics } from "../../../modules/designer/backend/erc/projection-checks";
import { designHeads, netIdentityState, pcbEntities, schematicLabels, schematicParts, schematicPins, schematicWires } from "../../../modules/designer/backend/schema";
import { trace } from "./helpers/drc-fixtures";

const TS = "2026-10-22T10:00:00.000Z", TS2 = "2026-10-22T11:00:00.000Z";
const DESIGN = "service-design";
const id = (seq: number): string => formatDurableNetId(designNetSalt(DESIGN), seq);
const migrations = new URL("../../../modules/designer/backend/migrations/", import.meta.url);

function fixture(empty = false): { db: NetIdentityDb; sqlite: Database } {
  const sqlite = new Database(":memory:");
  for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(new URL(name, migrations), "utf8").split("--> statement-breakpoint")) sqlite.exec(statement);
  }
  const db = drizzle(sqlite) as unknown as NetIdentityDb;
  db.insert(designHeads).values({ id: DESIGN, name: "Services", revision: 7, createdAt: TS, updatedAt: TS }).run();
  if (!empty) seedSchematic(db);
  return { db, sqlite };
}

function seedSchematic(db: NetIdentityDb): void {
  db.insert(schematicParts).values({ id: "part", designId: DESIGN, componentId: "component", reference: "U1", value: "", positionXNm: 0, positionYNm: 0, rotationDeg: 0, mirrored: 0, symbolSnapshotJson: "{}", footprintSnapshotJson: "{}", propertiesJson: "{}", createdAt: TS, updatedAt: TS }).run();
  for (const [index, pin] of ["a", "b", "c", "d"].entries()) {
    db.insert(schematicPins).values({ id: pin, designId: DESIGN, partId: "part", originPinKey: pin, number: String(index + 1), name: pin, electricalType: "passive", unit: 1, localXNm: index * 10_000_000, localYNm: 0, worldXNm: index * 10_000_000, worldYNm: 0, createdAt: TS, updatedAt: TS }).run();
  }
  wire(db, "ab", "a", "b", 0, 10);
  wire(db, "cd", "c", "d", 20, 30);
}

function wire(db: NetIdentityDb, key: string, from: string, to: string, x1: number, x2: number): void {
  db.insert(schematicWires).values({ id: key, designId: DESIGN, sourcePinId: from, targetPinId: to, pointsJson: JSON.stringify([{ x: x1 * 1_000_000, y: 0 }, { x: x2 * 1_000_000, y: 0 }]), createdAt: TS, updatedAt: TS }).run();
}

function raw(sqlite: Database): string {
  return JSON.stringify(sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

function copper(db: NetIdentityDb, netId: string): void {
  db.insert(pcbEntities).values({ id: "trace", designId: DESIGN, kind: "trace", payloadJson: JSON.stringify(trace("trace", netId, [[0, 0], [1, 0]])), createdAt: TS, updatedAt: TS }).run();
}

function currentBind(db: NetIdentityDb, previous = readNetIdentityState(db, DESIGN)!.active, watermark = 100) {
  const source = loadSchematicSource(db, DESIGN)!;
  const derived = deriveNetComponents(source.parts, source.wires, source.labels, source.primitives);
  return bindNetIdentity({ components: derived.components, previousActive: previous, salt: designNetSalt(DESIGN), seqWatermark: watermark, mode: "commit", pinLabel: () => undefined });
}

describe("identity mode and pure projection services", () => {
  test("mode reads absent/failed/corrupt state without writes and propagates SQLite failure", () => {
    const { db, sqlite } = fixture();
    expect(resolveIdentityMode(db, DESIGN)).toEqual({ mode: "legacy", state: null });
    initializeNetIdentity(db, DESIGN, "native", TS);
    expect(resolveIdentityMode(db, DESIGN).mode).toBe("durable");
    db.update(netIdentityState).set({ status: "migration_failed", lastError: "failed" }).run();
    expect(resolveIdentityMode(db, DESIGN).state!.lastError).toBe("failed");
    db.update(netIdentityState).set({ activeJson: "{broken" }).run();
    const before = raw(sqlite);
    expect(resolveIdentityMode(db, DESIGN)).toEqual({ mode: "legacy", state: null, unavailable: expect.stringContaining("invalid JSON") });
    expect(raw(sqlite)).toBe(before);
    sqlite.exec("DROP TABLE designer_net_identity_state");
    expect(() => resolveIdentityMode(db, DESIGN)).toThrow("no such table");
  });

  test("read-mode binding exposes pending/lone labels and attachments without DB writes", () => {
    const { db, sqlite } = fixture();
    db.delete(schematicWires).where(eq(schematicWires.id, "cd")).run();
    db.update(schematicPins).set({ number: null }).where(eq(schematicPins.id, "d")).run();
    db.insert(schematicLabels).values({ id: "label", designId: DESIGN, text: "SIGNAL", xNm: 0, yNm: 0, createdAt: TS, updatedAt: TS }).run();
    const source = loadSchematicSource(db, DESIGN)!;
    const derived = deriveNetComponents(source.parts, source.wires, source.labels, source.primitives);
    const before = raw(sqlite);
    const result = bindSchematicIdentity(source, derived, { previousActive: [], salt: designNetSalt(DESIGN), seqWatermark: 1, mode: "read" });
    expect(result.projection.nets.map((net) => net.id)).toEqual(["nc:c", "nc:d", "pending:0"]);
    expect(result.projection.nets.map((net) => net.name)).toEqual(["unconnected-(U1-3)", "unconnected-(d)", "SIGNAL"]);
    expect(result.projection.labels[0]!.attached).toBe(true);
    expect(result.projection.parts).toBe(source.parts);
    expect(result.projection.junctions).toBe(derived.junctions);
    expect(raw(sqlite)).toBe(before);
  });

  test("durable diagnostic anchors map to bound net ids while legacy warnings remain byte-identical", () => {
    const { db } = fixture();
    const source = loadSchematicSource(db, DESIGN)!;
    source.primitives = [
      { id: "gnd", kind: "gnd", positionNm: { x: 0, y: 0 }, rotationDeg: 0 },
      { id: "vcc", kind: "pwr", railText: "VCC", positionNm: { x: 0, y: 0 }, rotationDeg: 0 },
    ];
    source.labels = [{ id: "label", text: "SIGNAL", positionNm: { x: 0, y: 0 } }];
    const legacyBefore = JSON.stringify(deriveNetsAndJunctions(source.parts, source.wires, source.labels, source.primitives).warnings);
    const derived = deriveNetComponents(source.parts, source.wires, source.labels, source.primitives);
    const warningsBefore = JSON.stringify(derived.warnings);
    const { projection } = bindSchematicIdentity(source, derived, { previousActive: [], salt: designNetSalt(DESIGN), seqWatermark: 1, mode: "commit" });
    const diagnostics = checkNetDiagnostics(projection);
    expect(diagnostics.map((row) => row.code).sort()).toEqual(["LABEL_OVERRIDDEN_BY_GND", "PWR_RAIL_CONFLICT"]);
    for (const violation of diagnostics) for (const anchor of violation.anchors) {
      expect(anchor.kind === "net" && projection.nets.some((net) => net.id === anchor.netId)).toBe(true);
    }
    expect(JSON.stringify(derived.warnings)).toBe(warningsBefore);
    expect(JSON.stringify(deriveNetsAndJunctions(source.parts, source.wires, source.labels, source.primitives).warnings)).toBe(legacyBefore);
    expect(() => bindSchematicIdentity(source, { ...derived, warnings: derived.warnings.map((row) => ({ ...row, netRoot: "missing-root" })) }, { previousActive: [], salt: designNetSalt(DESIGN), seqWatermark: 1, mode: "commit" })).toThrow(NetIdentityStateInvalidError);
  });
});

describe("identity initialization and commit sync", () => {
  test("initialization allocates once without head/PCB writes; rejects missing head, reinit and retained ledger", () => {
    const { db, sqlite } = fixture();
    expect(() => initializeNetIdentity(db, "missing", "native", TS)).toThrow(NetIdentityStateInvalidError);
    expect(initializeNetIdentity(db, DESIGN, "native", TS).map((net) => net.id)).toEqual([id(1), id(2)]);
    expect(db.select().from(designHeads).get()!.revision).toBe(7);
    expect(db.select().from(pcbEntities).all()).toEqual([]);
    const before = raw(sqlite);
    expect(() => initializeNetIdentity(db, DESIGN, "native", TS2)).toThrow(NetIdentityStateInvalidError);
    expect(raw(sqlite)).toBe(before);
    db.delete(netIdentityState).run();
    writeNetIdentityRetired(db, { designId: DESIGN, netId: id(1), seq: 1, reason: "history", successorIds: [], displayName: "Old", retiredAtRevision: 1, createdAt: TS, updatedAt: TS });
    expect(() => initializeNetIdentity(db, DESIGN, "native", TS2)).toThrow(NetIdentityStateInvalidError);
    const empty = fixture(true);
    expect(initializeNetIdentity(empty.db, DESIGN, "kicad-import", TS)).toEqual([]);
    expect(readNetIdentityState(empty.db, DESIGN)!.nextSeq).toBe(1);
  });

  test("unchanged/moved geometry fast path reads no PCB table and writes no identity metadata", () => {
    const { db, sqlite } = fixture();
    initializeNetIdentity(db, DESIGN, "native", TS);
    sqlite.exec("DROP TABLE designer_pcb_entities");
    const before = raw(sqlite);
    expect(syncNetIdentity(db, DESIGN, 8, TS2)).toEqual({ changed: false, events: [] });
    expect(raw(sqlite)).toBe(before);
    db.update(schematicParts).set({ reference: "U9" }).run();
    expect(syncNetIdentity(db, DESIGN, 9, TS2)).toEqual({ changed: false, events: [] });
    expect(readNetIdentityState(db, DESIGN)!.updatedAt).toBe(TS);
  });

  test("split uses old dependent census; merge persists retirement/name/successor and avoids duplicate events", () => {
    const split = fixture();
    initializeNetIdentity(split.db, DESIGN, "native", TS);
    copper(split.db, id(1));
    split.db.delete(schematicWires).where(eq(schematicWires.id, "ab")).run();
    const splitResult = syncNetIdentity(split.db, DESIGN, 8, TS2);
    expect(splitResult.events).toHaveLength(1);
    expect(splitResult.events[0]!.kind).toBe("split");
    expect(splitResult.events[0]!.hasDependents).toBe(true);
    expect(readNetIdentityState(split.db, DESIGN)!.active.some((row) => row.id === id(1))).toBe(true);
    const merged = fixture();
    initializeNetIdentity(merged.db, DESIGN, "native", TS);
    copper(merged.db, id(2));
    wire(merged.db, "bc", "b", "c", 10, 20);
    const mergeResult = syncNetIdentity(merged.db, DESIGN, 8, TS2);
    expect(mergeResult.events).toHaveLength(1);
    expect(mergeResult.events[0]!.kind).toBe("merge");
    expect(readNetIdentityRetired(merged.db, DESIGN)[0]).toMatchObject({ netId: id(1), reason: "merged", displayName: "Net_1", successorIds: [id(2)], retiredAtRevision: 8 });
  });

  test("canonical census source never creates defaults and retains recovered declared rule references", () => {
    const { db, sqlite } = fixture(true);
    const before = raw(sqlite);
    expect(createNetDependentsCensus(loadNetReferenceSource(db, DESIGN)).count("old")).toBe(0);
    expect(raw(sqlite)).toBe(before);
    db.insert(pcbEntities).values({ id: "settings", designId: DESIGN, kind: "board_settings", payloadJson: JSON.stringify({ outline: null, perNetClassAssignments: { old: "default" } }), createdAt: TS, updatedAt: TS }).run();
    const stored = raw(sqlite);
    expect(createNetDependentsCensus(loadNetReferenceSource(db, DESIGN)).get("old").netClassAssignment).toBe(true);
    expect(raw(sqlite)).toBe(stored);
  });

  test("display overrides materialize names/provenance, preserve explicit labels, normalize collisions and remove exactly", () => {
    const { db } = fixture();
    initializeNetIdentity(db, DESIGN, "native", TS);
    setNetDisplayOverride(db, DESIGN, id(1), " Foo ");
    setNetDisplayOverride(db, DESIGN, id(2), "foo");
    expect(readNetIdentityState(db, DESIGN)!.active.map((row) => [row.name, row.nameSource, row.displayOverride])).toEqual([["Foo", "override", "Foo"], ["foo_1", "override", "foo"]]);
    db.insert(schematicLabels).values({ id: "label", designId: DESIGN, text: "EXPLICIT", xNm: 0, yNm: 0, createdAt: TS, updatedAt: TS }).run();
    syncNetIdentity(db, DESIGN, 8, TS2);
    setNetDisplayOverride(db, DESIGN, id(1), "Hidden override");
    expect(readNetIdentityState(db, DESIGN)!.active[0]).toMatchObject({ name: "EXPLICIT", nameSource: "label", displayOverride: "Hidden override" });
    db.delete(schematicLabels).run();
    syncNetIdentity(db, DESIGN, 9, TS2);
    expect(readNetIdentityState(db, DESIGN)!.active[0]!.name).toBe("Hidden override");
    setNetDisplayOverride(db, DESIGN, id(1), null);
    const restored = readNetIdentityState(db, DESIGN)!;
    expect(restored.active[0]!.nameSource).toBe("auto");
    expect(Object.hasOwn(restored.active[0]!, "displayOverride")).toBe(false);
    expect(restored.updatedAt).toBe(TS2);
    expect(restored.nextSeq).toBeGreaterThanOrEqual(3);
    expect(db.select().from(designHeads).get()!.revision).toBe(7);
  });

  test("invalid/reserved/foreign overrides refuse before writes", () => {
    const { db, sqlite } = fixture();
    initializeNetIdentity(db, DESIGN, "native", TS);
    const before = raw(sqlite);
    for (const name of ["", "  ", "Net_1", "Net_pending_2", "Net_1_2", "unconnected-(X)", "x".repeat(129)]) {
      expect(() => setNetDisplayOverride(db, DESIGN, id(1), name)).toThrow(NetIdentityStateInvalidError);
    }
    expect(() => setNetDisplayOverride(db, DESIGN, "nc:a", "Name")).toThrow(NetIdentityStateInvalidError);
    expect(() => setNetDisplayOverride(db, DESIGN, formatDurableNetId(designNetSalt("foreign"), 1), "Name")).toThrow(NetIdentityStateInvalidError);
    expect(raw(sqlite)).toBe(before);
  });

  test("neutral classifier covers all PCB commands and wholly neutral batches", () => {
    expect(isSchematicNeutralCommand({ type: "pcb_set_view_state", patch: {} })).toBe(true);
    expect(isSchematicNeutralCommand({ type: "batch_commands", commands: [] })).toBe(true);
    expect(isSchematicNeutralCommand({ type: "batch_commands", commands: [{ type: "pcb_set_active_layer", layer: "F.Cu" }] })).toBe(true);
    expect(isSchematicNeutralCommand({ type: "delete_entity", entityId: "part", entityKind: "part" })).toBe(false);
  });

  test("caller transaction rolls back state and ledger if sync persistence fails", () => {
    const { db, sqlite } = fixture();
    initializeNetIdentity(db, DESIGN, "native", TS);
    wire(db, "bc", "b", "c", 10, 20);
    sqlite.exec("CREATE TRIGGER refuse_retirement BEFORE INSERT ON designer_net_identity_retired BEGIN SELECT RAISE(ABORT, 'sync retirement fault'); END");
    const before = raw(sqlite);
    expect(() => db.transaction((tx) => syncNetIdentity(tx as NetIdentityDb, DESIGN, 8, TS2))).toThrow("sync retirement fault");
    expect(raw(sqlite)).toBe(before);
  });
});

describe("replay identity persistence", () => {
  test("reactivation retains retired ledger and monotonic counter; vanished DB identity gets history retirement and postpatch orphan event", () => {
    const { db } = fixture();
    initializeNetIdentity(db, DESIGN, "native", TS);
    const prior = readNetIdentityState(db, DESIGN)!;
    prior.nextSeq = 100;
    writeNetIdentityState(db, prior);
    writeNetIdentityRetired(db, { designId: DESIGN, netId: id(3), seq: 3, reason: "history", successorIds: [], displayName: "Restored old", retiredAtRevision: 6, createdAt: TS, updatedAt: TS });
    const previous = prior.active.map((row) => row.id === id(2) ? { ...row, id: id(3), name: "Restored old" } : row);
    const bind = currentBind(db, previous, 100);
    bind.nextSeq = 4;
    const census = createNetDependentsCensus({ board: {}, traces: [{ id: "postpatch", netId: id(2) }], vias: [], freePads: [], zones: [] });
    const result = persistReplayIdentity(db, DESIGN, prior, previous, bind, census, 8, TS2);
    expect(readNetIdentityState(db, DESIGN)!.nextSeq).toBe(100);
    expect(readNetIdentityState(db, DESIGN)!.active.map((row) => row.id)).toEqual([id(1), id(3)]);
    expect(readNetIdentityRetired(db, DESIGN).map((row) => [row.netId, row.reason])).toEqual([[id(2), "history"], [id(3), "history"]]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ kind: "removed", netId: id(2), netName: "Net_2", hasDependents: true });
  });

  test("prior ownership rejects duplicate members rather than silently overwriting", () => {
    const { db } = fixture();
    initializeNetIdentity(db, DESIGN, "native", TS);
    const active = readNetIdentityState(db, DESIGN)!.active;
    const owners = priorNetOwners(active);
    expect(owners.get(JSON.stringify(["pin", "a"]))).toBe(id(1));
    const conflict = structuredClone(active);
    conflict[1]!.members.push(conflict[0]!.members[0]!);
    expect(() => priorNetOwners(conflict)).toThrow(NetIdentityStateInvalidError);
  });

  test("sanitized-away prior DB identity retires as history using postpatch dependents and prior DB name", () => {
    const { db } = fixture();
    initializeNetIdentity(db, DESIGN, "native", TS);
    const prior = readNetIdentityState(db, DESIGN)!;
    prior.active.push({ id: id(3), name: "Prior DB name", nameSource: "auto", members: [{ kind: "pin", id: "ghost" }] });
    prior.nextSeq = 100;
    writeNetIdentityState(db, prior);
    const patched = prior.active.map((row) => row.id === id(3)
      ? { ...row, name: "Patched name", members: [{ kind: "pin" as const, id: "a" }] } : row);
    const source = loadSchematicSource(db, DESIGN)!;
    const derived = deriveNetComponents(source.parts, source.wires, source.labels, source.primitives);
    const bind = bindNetIdentity({ previousActive: patched, components: derived.components, salt: designNetSalt(DESIGN), seqWatermark: 100, mode: "commit", pinLabel: () => undefined, priorOwner: priorNetOwners(prior.active) });
    expect(bind.sanitized).toHaveLength(1);
    expect(bind.retirements).toEqual([]);
    const census = createNetDependentsCensus({ board: {}, traces: [{ id: "postpatch-only", netId: id(3) }], vias: [], freePads: [], zones: [] });
    const result = persistReplayIdentity(db, DESIGN, prior, patched, bind, census, 8, TS2);
    expect(readNetIdentityRetired(db, DESIGN)[0]).toMatchObject({ netId: id(3), reason: "history", displayName: "Prior DB name" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ kind: "removed", netId: id(3), netName: "Prior DB name", hasDependents: true });
    expect(db.select().from(pcbEntities).all()).toEqual([]);
  });

  test("reactivating retired identity alone emits no event and leaves allocation history intact", () => {
    const { db } = fixture();
    initializeNetIdentity(db, DESIGN, "native", TS);
    const original = readNetIdentityState(db, DESIGN)!;
    const prior = { ...original, active: [original.active[0]!], nextSeq: 100 };
    writeNetIdentityState(db, prior);
    writeNetIdentityRetired(db, { designId: DESIGN, netId: id(3), seq: 3, reason: "history", successorIds: [], displayName: "Old", retiredAtRevision: 5, createdAt: TS, updatedAt: TS });
    const patched = [prior.active[0]!, { ...original.active[1]!, id: id(3) }];
    const bind = currentBind(db, patched, 100);
    const census = createNetDependentsCensus({ board: {}, traces: [], vias: [], freePads: [], zones: [] });
    expect(persistReplayIdentity(db, DESIGN, prior, patched, bind, census, 8, TS2).events).toEqual([]);
    expect(readNetIdentityRetired(db, DESIGN).map((row) => row.netId)).toEqual([id(3)]);
    expect(readNetIdentityState(db, DESIGN)!.active.map((row) => row.id)).toEqual([id(1), id(3)]);
  });
});
