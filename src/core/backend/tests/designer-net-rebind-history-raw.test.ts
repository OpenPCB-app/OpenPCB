import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { AppError } from "../../contracts/errors";
import { applyRawNetRebindDelta, invertRawNetRebindDelta, validateRawNetRebindDelta } from "../../../modules/designer/backend/net-identity/rebind-history";
import type { RawNetRebindDelta, RawNetRebindRowDelta, RawNetRebindSlot } from "../../../modules/designer/backend/net-identity/rebind-history-types";
import type { NetIdentityDb } from "../../../modules/designer/backend/net-identity/state-store";
import { pcbEntities } from "../../../modules/designer/backend/schema";

const DESIGN = "design", TS = "2026-10-22T22:00:00.000Z";
const databases: Array<{ sqlite: Database; directory: string }> = [];
afterEach(() => {
  for (const { sqlite, directory } of databases.splice(0)) { sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "net-rebind-history-")), sqlite = new Database(join(directory, "app.sqlite"));
  databases.push({ sqlite, directory });
  sqlite.exec("CREATE TABLE designer_pcb_entities (id TEXT PRIMARY KEY, design_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  const db = drizzle(sqlite) as unknown as NetIdentityDb;
  const insert = (id: string, kind: string, payload: unknown, designId = DESIGN) => db.insert(pcbEntities).values({
    id, kind, designId, payloadJson: JSON.stringify(payload), createdAt: "original-created", updatedAt: "original-updated",
  }).run();
  const rows = () => db.select().from(pcbEntities).all().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const read = (rowId: string) => db.select().from(pcbEntities).where(eq(pcbEntities.id, rowId)).get()!;
  const payload = (rowId: string) => JSON.parse(read(rowId).payloadJson) as Record<string, unknown>;
  return { db, sqlite, insert, rows, read, payload };
}

function slot(value: unknown): RawNetRebindSlot { return { exists: true, value }; }
function delta(rows: RawNetRebindRowDelta[] = []): RawNetRebindDelta { return { version: 1, designId: DESIGN, rows }; }
function copper(rowId = "trace-row", kind: RawNetRebindRowDelta["kind"] = "trace"): RawNetRebindRowDelta {
  return { rowId, kind, payloadId: "copper", fields: [{ key: "netId", before: slot("old"), after: slot("new") }] };
}
function conflict(work: () => unknown): void {
  let caught: unknown;
  try { work(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).status).toBe(409);
  expect((caught as AppError).extras?.code).toBe("NET_REBIND_HISTORY_CONFLICT");
}

describe("raw net rebind history", () => {
  test("patches reference fields only and inverse preserves current unrelated copper geometry", () => {
    const fixture = setup();
    fixture.insert("trace-row", "trace", { id: "copper", netId: "old", pointsNm: [{ x: 1, y: 2 }], future: { preserve: true } });
    const input = delta([copper()]), original = structuredClone(input);
    applyRawNetRebindDelta(fixture.db, DESIGN, input, TS);
    expect(fixture.payload("trace-row")).toEqual({ id: "copper", netId: "new", pointsNm: [{ x: 1, y: 2 }], future: { preserve: true } });
    fixture.db.update(pcbEntities).set({ payloadJson: JSON.stringify({ ...fixture.payload("trace-row"), pointsNm: [{ x: 30, y: 40 }], newer: ["keep"] }) }).run();
    applyRawNetRebindDelta(fixture.db, DESIGN, invertRawNetRebindDelta(input), "inverse-time");
    expect(fixture.payload("trace-row")).toEqual({ id: "copper", netId: "old", pointsNm: [{ x: 30, y: 40 }], future: { preserve: true }, newer: ["keep"] });
    expect(fixture.read("trace-row")).toMatchObject({ id: "trace-row", createdAt: "original-created", updatedAt: "inverse-time" });
    expect(input).toEqual(original);
  });

  test("own absence differs from null, including raw free-pad name and prototype-like metadata", () => {
    const fixture = setup(), raw = JSON.parse('{"id":"copper","netId":"old","netName":null,"__proto__":{"keep":1}}') as Record<string, unknown>;
    fixture.insert("pad-row", "free_pad", raw);
    const row = copper("pad-row", "free_pad");
    row.fields.push({ key: "netName", before: slot(null), after: { exists: false } });
    const input = delta([row]);
    applyRawNetRebindDelta(fixture.db, DESIGN, input, TS);
    expect(Object.hasOwn(fixture.payload("pad-row"), "netName")).toBe(false);
    expect(fixture.payload("pad-row")["__proto__"]).toEqual({ keep: 1 });
    applyRawNetRebindDelta(fixture.db, DESIGN, invertRawNetRebindDelta(input), TS);
    expect(fixture.payload("pad-row")).toEqual(raw);
    row.fields[1]!.before = { exists: false };
    conflict(() => applyRawNetRebindDelta(fixture.db, DESIGN, delta([row]), TS));
  });

  test("whole raw board sections restore unknown rows, metadata and order without resetting view settings", () => {
    const fixture = setup();
    const groups = [{ id: "z", future: { keep: true }, netIds: ["old", "old"] }, { kind: "future", arbitrary: [1, null] }];
    const assignments = JSON.parse('{"__proto__":"future-class","old":"default"}') as unknown;
    const rules = [{ id: "rule", scopes: [{ kind: "future", metadata: ["keep"] }], opaque: { nested: 2 } }];
    fixture.insert("board-row", "board_settings", { lengthMatchGroups: groups, perNetClassAssignments: assignments, drcRules: rules, viewState: { ratsnestVisible: true }, future: "keep" });
    const input = delta([{ rowId: "board-row", kind: "board_settings", payloadId: null, fields: [
      { key: "lengthMatchGroups", before: slot(groups), after: { exists: false } },
      { key: "perNetClassAssignments", before: slot(assignments), after: slot({ new: "default" }) },
      { key: "drcRules", before: slot(rules), after: { exists: false } },
      { key: "diffPairs", before: { exists: false }, after: slot([{ id: "pair", future: true }]) },
    ] }]);
    applyRawNetRebindDelta(fixture.db, DESIGN, input, TS);
    fixture.db.update(pcbEntities).set({ payloadJson: JSON.stringify({ ...fixture.payload("board-row"), viewState: { ratsnestVisible: false, futureView: 3 } }) }).run();
    applyRawNetRebindDelta(fixture.db, DESIGN, invertRawNetRebindDelta(input), "undo-time");
    const restored = fixture.payload("board-row");
    expect(restored.lengthMatchGroups).toEqual(groups); expect(restored.drcRules).toEqual(rules);
    expect(restored.perNetClassAssignments).toEqual(assignments); expect(Object.hasOwn(restored, "diffPairs")).toBe(false);
    expect(restored.viewState).toEqual({ ratsnestVisible: false, futureView: 3 });
    expect(restored).toMatchObject({ future: "keep", updatedAt: "undo-time", schemaVersion: 1 });
    expect(fixture.read("board-row").createdAt).toBe("original-created");
  });

  test("zone enabled and reference fields support immutable inversion", () => {
    const fixture = setup(); fixture.insert("zone-row", "zone", { id: "copper", netId: "old", enabled: true, region: { kind: "board" } });
    const row = copper("zone-row", "zone"); row.fields.push({ key: "enabled", before: slot(true), after: slot(false) });
    const input = delta([row]), inverted = invertRawNetRebindDelta(input);
    applyRawNetRebindDelta(fixture.db, DESIGN, input, TS);
    expect(fixture.payload("zone-row")).toMatchObject({ enabled: false, netId: "new" });
    applyRawNetRebindDelta(fixture.db, DESIGN, inverted, TS);
    expect(fixture.payload("zone-row")).toMatchObject({ enabled: true, netId: "old" });
    expect(invertRawNetRebindDelta(inverted)).toEqual(input);
  });

  test("late conflict preflights all operations before any write, even without an outer transaction", () => {
    const fixture = setup(); fixture.insert("trace-row", "trace", { id: "copper", netId: "old" });
    fixture.insert("via-row", "via", { id: "via", netId: "changed" });
    const via = { ...copper("via-row", "via"), payloadId: "via" }, before = fixture.rows();
    conflict(() => applyRawNetRebindDelta(fixture.db, DESIGN, delta([copper(), via]), TS));
    expect(fixture.rows()).toEqual(before);
  });

  test("board replay refuses duplicate current board rows before copper writes", () => {
    const fixture = setup(); fixture.insert("trace-row", "trace", { id: "copper", netId: "old" });
    fixture.insert("board", "board_settings", { diffPairs: [] });
    fixture.insert("duplicate-board", "board_settings", { future: true });
    const board: RawNetRebindRowDelta = { rowId: "board", kind: "board_settings", payloadId: null,
      fields: [{ key: "diffPairs", before: slot([]), after: { exists: false } }] };
    const before = fixture.rows();
    conflict(() => applyRawNetRebindDelta(fixture.db, DESIGN, delta([copper(), board]), TS));
    expect(fixture.rows()).toEqual(before);
  });

  test.each(["absent", "wrong design", "wrong kind", "wrong payload", "duplicate payload", "cross-kind duplicate payload", "malformed JSON"])("%s refuses without changes", (reason) => {
    const fixture = setup(); fixture.insert("trace-row", "trace", { id: "copper", netId: "old" });
    const row = copper();
    if (reason === "absent") row.rowId = "missing";
    if (reason === "wrong design") fixture.db.update(pcbEntities).set({ designId: "other" }).run();
    if (reason === "wrong kind") row.kind = "via";
    if (reason === "wrong payload") row.payloadId = "other";
    if (reason.includes("duplicate payload")) fixture.insert("duplicate", reason === "duplicate payload" ? "trace" : "zone", { id: "copper", netId: "old" });
    if (reason === "malformed JSON") fixture.db.update(pcbEntities).set({ payloadJson: "{bad" }).run();
    const before = fixture.rows();
    conflict(() => applyRawNetRebindDelta(fixture.db, DESIGN, delta([row]), TS));
    expect(fixture.rows()).toEqual(before);
  });

  test("database write failure propagates and caller transaction rolls back earlier writes", () => {
    const fixture = setup(); fixture.insert("trace-row", "trace", { id: "copper", netId: "old" });
    fixture.insert("via-row", "via", { id: "via", netId: "old" });
    fixture.sqlite.exec("CREATE TRIGGER reject_via BEFORE UPDATE ON designer_pcb_entities WHEN OLD.kind = 'via' BEGIN SELECT RAISE(ABORT, 'write blocked'); END");
    const input = delta([copper(), { ...copper("via-row", "via"), payloadId: "via" }]), before = fixture.rows();
    let caught: unknown;
    try { fixture.db.transaction((tx) => applyRawNetRebindDelta(tx as NetIdentityDb, DESIGN, input, TS)); } catch (error) { caught = error; }
    expect(caught).toBeDefined(); expect(caught).not.toBeInstanceOf(AppError);
    expect(String(caught)).toContain("write blocked"); expect(fixture.rows()).toEqual(before);
  });

  test("payload parsing scales linearly across a bulk repair", () => {
    const fixture = setup(), count = 120;
    const rows = Array.from({ length: count }, (_, index) => ({ ...copper(`row-${index}`), payloadId: `payload-${index}` }));
    fixture.db.transaction(() => {
      for (const row of rows) fixture.insert(row.rowId, row.kind, { id: row.payloadId, netId: "old", future: { preserve: true } });
    });
    const parse = spyOn(JSON, "parse");
    let calls = 0;
    try { applyRawNetRebindDelta(fixture.db, DESIGN, delta(rows), TS); calls = parse.mock.calls.length; }
    finally { parse.mockRestore(); }
    expect(calls).toBeLessThanOrEqual(count * 5);
    expect(fixture.rows().every((row) => (JSON.parse(row.payloadJson) as { netId: string }).netId === "new")).toBe(true);
  });
});

describe("raw delta carrier validation", () => {
  test("empty plans and detached validated/inverted JSON values are supported", () => {
    expect(validateRawNetRebindDelta(delta(), DESIGN)).toEqual(delta());
    const fixture = setup(), before = fixture.rows();
    applyRawNetRebindDelta(fixture.db, DESIGN, delta(), TS); expect(fixture.rows()).toEqual(before);
    const input = delta([{ rowId: "board", kind: "board_settings", payloadId: null,
      fields: [{ key: "drcRules", before: slot([{ future: [1, null] }]), after: { exists: false } }] }]);
    const validated = validateRawNetRebindDelta(input, DESIGN);
    expect(validated).toEqual(input); expect(validated.rows[0]!.fields[0]!.before).not.toBe(input.rows[0]!.fields[0]!.before);
  });

  const invalids: Array<[string, () => unknown]> = [
    ["null", () => null], ["future version", () => ({ ...delta(), version: 2 })],
    ["foreign design", () => ({ ...delta(), designId: "other" })], ["blank design", () => ({ ...delta(), designId: " " })],
    ["unknown carrier key", () => ({ ...delta(), arbitrary: true })], ["rows object", () => ({ ...delta(), rows: {} })],
    ["empty fields", () => delta([{ ...copper(), fields: [] }])], ["duplicate row", () => delta([copper(), { ...copper(), kind: "via" }])],
    ["unknown row kind", () => delta([{ ...copper(), kind: "part" } as unknown as RawNetRebindRowDelta])],
    ["blank row ID", () => delta([{ ...copper(), rowId: " " }])], ["blank payload ID", () => delta([{ ...copper(), payloadId: "" }])],
    ["null copper payload ID", () => delta([{ ...copper(), payloadId: null }])],
    ["board payload ID", () => delta([{ ...copper(), kind: "board_settings", fields: [{ key: "drcRules", before: slot([]), after: slot([1]) }] }])],
    ["arbitrary field", () => delta([{ ...copper(), fields: [{ key: "positionMm", before: slot("old"), after: slot("new") }] }])],
    ["copper enabled", () => delta([{ ...copper(), fields: [{ key: "enabled", before: slot(true), after: slot(false) }] }])],
    ["nonstring net", () => delta([{ ...copper(), fields: [{ key: "netId", before: slot(4), after: slot("new") }] }])],
    ["nonboolean enabled", () => delta([{ ...copper("zone", "zone"), fields: [{ key: "enabled", before: slot(1), after: slot(false) }] }])],
    ["noop field", () => delta([{ ...copper(), fields: [{ key: "netId", before: slot(null), after: slot(null) }] }])],
    ["duplicate field", () => delta([{ ...copper(), fields: [...copper().fields, ...copper().fields] }])],
    ["undefined JSON", () => delta([{ ...copper(), fields: [{ key: "netName", before: slot(null), after: slot(undefined) }] }])],
    ["absent slot value", () => delta([{ ...copper(), fields: [{ key: "netName", before: { exists: false, value: "hidden" } as RawNetRebindSlot, after: slot(null) }] }])],
    ["row extra key", () => delta([{ ...copper(), geometry: {} } as RawNetRebindRowDelta])],
    ["field extra key", () => ({ ...delta(), rows: [{ ...copper(), fields: [{ ...copper().fields[0]!, hidden: true }] }] })],
    ["blank before net ID", () => delta([{ ...copper(), fields: [{ key: "netId", before: slot(" "), after: slot("new") }] }])],
    ["blank after net ID", () => delta([{ ...copper(), fields: [{ key: "netId", before: slot("old"), after: slot("") }] }])],
    ["sparse rows", () => ({ ...delta(), rows: new Array(1) })],
    ["sparse fields", () => delta([{ ...copper(), fields: new Array(1) }])],
    ["extra array property", () => ({ ...delta(), rows: Object.assign([copper()], { hidden: true }) })],
    ["multiple board rows", () => delta(["first", "second"].map((rowId) => ({ rowId, kind: "board_settings", payloadId: null,
      fields: [{ key: "diffPairs", before: slot([]), after: { exists: false } }] })))],
  ];
  test.each(invalids)("%s is a history conflict", (_label, value) => {
    const fixture = setup(), before = fixture.rows();
    conflict(() => validateRawNetRebindDelta(value(), DESIGN));
    conflict(() => applyRawNetRebindDelta(fixture.db, DESIGN, value(), TS));
    expect(fixture.rows()).toEqual(before);
  });

  test.each([NaN, Infinity, undefined, 1n, () => 1, Symbol("bad"), new Date(), new Map()])("invalid JSON leaf %s is refused", (bad) => {
    const input = delta([{ rowId: "board", kind: "board_settings", payloadId: null,
      fields: [{ key: "drcRules", before: slot([]), after: slot([{ nested: bad }]) }] }]);
    conflict(() => validateRawNetRebindDelta(input, DESIGN));
  });

  test("cycles and sparse arrays are refused; repeated acyclic objects remain JSON", () => {
    const value: Record<string, unknown> = {}; value.cycle = value;
    const row = { rowId: "board", kind: "board_settings" as const, payloadId: null,
      fields: [{ key: "drcRules", before: slot([]), after: slot(value) }] };
    conflict(() => validateRawNetRebindDelta(delta([row]), DESIGN));
    row.fields[0]!.after = slot(new Array(2)); conflict(() => validateRawNetRebindDelta(delta([row]), DESIGN));
    const leaf = { future: true }; row.fields[0]!.after = slot([leaf, leaf]);
    expect(validateRawNetRebindDelta(delta([row]), DESIGN).rows).toHaveLength(1);
  });
});
