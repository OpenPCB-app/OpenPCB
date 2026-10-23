import { describe, expect, test } from "bun:test";
import type { NetRebindReceipt } from "../../../sdks/designer/net-rebind";
import { danglingReference, type NetReferenceJudge } from "../../../modules/designer/backend/net-identity/command-reference-id";
import { planNetReferenceRebind } from "../../../modules/designer/backend/net-identity/rebind-plan";
import type { RawNetRebindDelta } from "../../../modules/designer/backend/net-identity/rebind-history-types";
import { validateRawNetRebindDelta } from "../../../modules/designer/backend/net-identity/rebind-history-validation";
import type { pcbEntities } from "../../../modules/designer/backend/schema";

type Row = typeof pcbEntities.$inferSelect;
const DESIGN = "repair-design", TS = "2026-10-22T00:00:00.000Z";
const OLD = "net:old:1", ACTIVE = "net:active:1", OTHER = "nc:active-pin";
const activeIds = new Set([ACTIVE, OTHER]);
const judge: NetReferenceJudge = (id, field) => id === null || activeIds.has(id) ? null :
  danglingReference(field, id, id.startsWith("pending:") ? "pending" : "unknown");
const binding = (fromNetId: string | null, toNetId: string | null, fromNetName?: string | null) =>
  ({ fromNetId, toNetId, ...(fromNetName !== undefined ? { fromNetName } : {}) });

function row(kind: string, payload: unknown, id = kind): Row {
  return { id, kind, designId: DESIGN, payloadJson: JSON.stringify(payload), createdAt: TS, updatedAt: TS };
}
function plan(rows: Row[], bindings: unknown = [binding(OLD, ACTIVE)]) {
  return planNetReferenceRebind({ designId: DESIGN, activeIds, judge, rows, bindings });
}
function success(rows: Row[], bindings: unknown = [binding(OLD, ACTIVE)]) {
  const result = plan(rows, bindings);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}
function after(rows: Row[], delta: RawNetRebindDelta, rowId: string): Record<string, unknown> {
  const payload = JSON.parse(rows.find((row) => row.id === rowId)!.payloadJson) as Record<string, unknown>;
  for (const field of delta.rows.find((row) => row.rowId === rowId)?.fields ?? []) {
    if (field.after.exists) Object.defineProperty(payload, field.key, { value: field.after.value, enumerable: true, configurable: true, writable: true });
    else delete payload[field.key];
  }
  return payload;
}
function emptyReceipt(): NetRebindReceipt {
  return { traces: 0, vias: 0, zones: 0, freePads: 0, assignments: 0, lengthGroups: 0, diffPairs: 0, drcRules: 0,
    removedRules: [], removedDiffPairs: [], removedLengthGroups: [], disabledZones: [] };
}
function invalid(result: ReturnType<typeof plan>, detail: string): void {
  expect(result).toMatchObject({ ok: false, result: { code: "INVALID_PCB_BOARD_SETTINGS", detail: expect.stringContaining(detail) } });
}
function board(): Record<string, unknown> {
  return { id: "opaque-board-id", outline: { kind: "future", retain: true }, viewState: { future: "keep" },
    perNetClassAssignments: { [OLD]: "class" },
    lengthMatchGroups: [{ id: "length", name: "Length", netIds: [OLD, "untouched", OLD, ACTIVE], target: { kind: "future", detail: [1, 2] }, extra: "keep" }],
    diffPairs: [{ id: "pair", pNetId: OLD, nNetId: "untouched", name: "Pair", extra: { keep: true } }],
    drcRules: [{ id: "rule", enabled: true, constraint: { kind: "future", keep: true },
      scopes: [{ kind: "layer", layers: ["F.Cu"], extra: 1 }, { kind: "net", netIds: [OLD, "untouched", OLD, ACTIVE], extra: { keep: true } }, null, { kind: "future", payload: [1, 2] }] }] };
}

describe("raw physical reference repair plan", () => {
  test("all four copper kinds change only netId and retain raw hints, geometry and unknown metadata", () => {
    const rows = ["trace", "via", "free_pad", "zone"].map((kind) => row(kind,
      { id: kind, netId: OLD, netName: " Stale provenance ", geometry: { future: [1, 2] }, enabled: false }));
    const authored = JSON.stringify(rows), bindings = [binding(OLD, ACTIVE, "ignored")], originalBindings = JSON.stringify(bindings);
    const result = success(rows, bindings);
    expect(result.receipt).toEqual({ ...emptyReceipt(), traces: 1, vias: 1, freePads: 1, zones: 1 });
    for (const item of rows) {
      expect(result.delta.rows.find((delta) => delta.rowId === item.id)!.fields).toEqual([
        { key: "netId", before: { exists: true, value: OLD }, after: { exists: true, value: ACTIVE } },
      ]);
      expect(after(rows, result.delta, item.id)).toEqual({ ...JSON.parse(item.payloadJson) as Record<string, unknown>, netId: ACTIVE });
    }
    expect(JSON.stringify(rows)).toBe(authored); expect(JSON.stringify(bindings)).toBe(originalBindings);
  });
  test("clear nulls both fields, including free-pad hints, and lists every cleared zone even if disabled", () => {
    const rows = [row("trace", { id: "trace", netId: OLD }), row("via", { id: "via", netId: OLD, netName: "old" }),
      row("free_pad", { id: "pad", netId: OLD, netName: "opaque" }),
      ...[true, false].map((enabled, index) => row("zone", { id: `zone-${index}`, netId: OLD, netName: "old", enabled, other: "keep" }, `zone-row-${index}`))];
    const result = success(rows, [binding(OLD, null)]);
    expect(result.receipt).toEqual({ ...emptyReceipt(), traces: 1, vias: 1, freePads: 1, zones: 2, disabledZones: ["zone-0", "zone-1"] });
    for (const item of rows) expect(after(rows, result.delta, item.id)).toMatchObject({ netId: null, netName: null, ...(item.kind === "zone" ? { enabled: false, other: "keep" } : {}) });
    expect(result.delta.rows.find((entry) => entry.rowId === "trace")!.fields[1]).toEqual({ key: "netName", before: { exists: false }, after: { exists: true, value: null } });
  });
  test("exact hint selection preserves case/whitespace and nonnull ID takes priority", () => {
    const rows = [row("trace", { id: "exact", netId: null, netName: " GND " }, "exact"),
      row("trace", { id: "case", netId: null, netName: " gnd " }, "case"), row("trace", { id: "trim", netId: null, netName: "GND" }, "trim"),
      row("trace", { id: "id", netId: "other-inactive", netName: " GND " }, "id")];
    const result = success(rows, [binding(null, ACTIVE, " GND ")]);
    expect(result.receipt.traces).toBe(1); expect(result.delta.rows.map((row) => row.rowId)).toEqual(["exact"]);
    expect(after(rows, result.delta, "exact")).toEqual({ id: "exact", netId: ACTIVE, netName: " GND " });
  });
  test("canonical absent netId selects unresolved hint; absent enabled stays absent for a nonnull target", () => {
    const rows = [row("zone", { id: "zone", netName: "Hint", geometry: "raw" })];
    const bound = success(rows, [binding(null, ACTIVE, "Hint")]);
    expect(bound.delta.rows[0]!.fields).toEqual([{ key: "netId", before: { exists: false }, after: { exists: true, value: ACTIVE } }]);
    expect(after(rows, bound.delta, "zone")).not.toHaveProperty("enabled");
    const cleared = success(rows, [binding(null, null, "Hint")]);
    expect(after(rows, cleared.delta, "zone")).toEqual({ id: "zone", geometry: "raw", netId: null, netName: null, enabled: false });
    expect(cleared.receipt.disabledZones).toEqual(["zone"]);
  });
  test("inactive nc and foreign source IDs are exact repairable values; active and null targets work", () => {
    for (const id of ["nc:retired-pin", "foreign-design-value", "pending:old", "__proto__", "constructor"]) {
      const rows = [row("via", { id: "via", netId: id, netName: "Hint" })];
      expect(after(rows, success(rows, [binding(id, OTHER)]).delta, "via").netId).toBe(OTHER);
      expect(after(rows, success(rows, [binding(id, null)]).delta, "via")).toMatchObject({ netId: null, netName: null });
    }
  });
  test("no matches returns empty delta and zero receipt without parsing unrelated geometry", () => {
    const rows = [row("placement", "unknown placement format"), row("trace", { id: "trace", netId: "unmatched", geometry: null })];
    expect(success(rows)).toEqual({ ok: true, delta: { version: 1, designId: DESIGN, rows: [] }, receipt: emptyReceipt() });
  });
  test("all generated copper/board deltas satisfy the strict raw history carrier contract", () => {
    const rows = [row("board_settings", board()), ...["trace", "via", "free_pad", "zone"].map((kind) => row(kind, { id: kind, netId: OLD, enabled: false }))];
    for (const target of [ACTIVE, null]) {
      const result = success(rows, [binding(OLD, target)]);
      expect(validateRawNetRebindDelta(result.delta, DESIGN)).toEqual(result.delta);
    }
  });
});

describe("raw board repair", () => {
  test("every rule site maps simultaneously, deduplicates changed references and preserves metadata", () => {
    const rows = [row("board_settings", board())], authored = JSON.stringify(rows), result = success(rows);
    const next = after(rows, result.delta, "board_settings");
    expect(result.receipt).toEqual({ ...emptyReceipt(), assignments: 1, lengthGroups: 1, diffPairs: 1, drcRules: 1 });
    expect(next).toEqual({ ...board(), perNetClassAssignments: { [ACTIVE]: "class" },
      lengthMatchGroups: [{ id: "length", name: "Length", netIds: [ACTIVE, "untouched"], target: { kind: "future", detail: [1, 2] }, extra: "keep" }],
      diffPairs: [{ id: "pair", pNetId: ACTIVE, nNetId: "untouched", name: "Pair", extra: { keep: true } }],
      drcRules: [{ id: "rule", enabled: true, constraint: { kind: "future", keep: true }, scopes: [
        { kind: "layer", layers: ["F.Cu"], extra: 1 }, { kind: "net", netIds: [ACTIVE, "untouched"], extra: { keep: true } }, null, { kind: "future", payload: [1, 2] } ] }] });
    expect(result.delta.rows[0]!.payloadId).toBeNull(); expect(result.delta.rows[0]!.fields).toHaveLength(4);
    expect(result.delta.rows[0]!.fields[1]!.before).toEqual({ exists: true, value: board().lengthMatchGroups });
    expect(JSON.stringify(rows)).toBe(authored);
  });
  test("clear deletes newly empty length groups, null/collapsed pairs and newly empty-scope rules only", () => {
    const raw = { lengthMatchGroups: [{ id: "remove-length", netIds: [OLD], metadata: true }, { id: "already-empty", netIds: [] }],
      diffPairs: [{ id: "remove-pair", pNetId: OLD, nNetId: "unrelated" }, { id: "already-collapsed", pNetId: "unrelated", nNetId: "unrelated" }],
      drcRules: [{ id: "remove-rule", scopes: [{ kind: "net", netIds: [OLD] }, { kind: "net", netIds: [ACTIVE] }], metadata: [1] },
        { id: "already-empty-rule", scopes: [{ kind: "net", netIds: [] }] }] };
    const rows = [row("board_settings", raw)], result = success(rows, [binding(OLD, null)]), next = after(rows, result.delta, "board_settings");
    expect(next).toEqual({ lengthMatchGroups: [{ id: "already-empty", netIds: [] }],
      diffPairs: [{ id: "already-collapsed", pNetId: "unrelated", nNetId: "unrelated" }], drcRules: [{ id: "already-empty-rule", scopes: [{ kind: "net", netIds: [] }] }] });
    expect(result.receipt).toEqual({ ...emptyReceipt(), lengthGroups: 1, diffPairs: 1, drcRules: 1,
      removedLengthGroups: ["remove-length"], removedDiffPairs: ["remove-pair"], removedRules: ["remove-rule"] });
  });
  test("mapping collapses pair and multiple sources coalesce references without cascading through hints", () => {
    const rows = [row("board_settings", { diffPairs: [{ id: "pair", pNetId: OLD, nNetId: ACTIVE }],
      lengthMatchGroups: [{ id: "length", netIds: [OLD, "other-old", "untouched", OTHER] }] }),
      row("trace", { id: "trace", netId: OLD, netName: "OTHER_HINT" })];
    const bindings = [binding(OLD, ACTIVE), binding("other-old", OTHER), binding(null, OTHER, "OTHER_HINT")];
    const result = success(rows, bindings), permuted = success([...rows].reverse(), [...bindings].reverse());
    expect(result).toEqual(permuted); expect(result.receipt.removedDiffPairs).toEqual(["pair"]);
    expect(after(rows, result.delta, "board_settings")).toEqual({ diffPairs: [], lengthMatchGroups: [{ id: "length", netIds: [ACTIVE, OTHER, "untouched"] }] });
    expect(after(rows, result.delta, "trace").netId).toBe(ACTIVE);
  });
  test("existing assignment target wins; absent target coalesces equal classes and rejects differing classes", () => {
    const make = (classes: Record<string, unknown>) => [row("board_settings", { perNetClassAssignments: classes, unrelated: true })];
    const bindings = [binding(OLD, ACTIVE), binding("other-old", ACTIVE)];
    const existing = make({ [OLD]: "first", "other-old": "second", [ACTIVE]: { future: "existing wins" } });
    const winner = success(existing, bindings);
    expect(after(existing, winner.delta, "board_settings")).toEqual({ perNetClassAssignments: { [ACTIVE]: { future: "existing wins" } }, unrelated: true });
    expect(winner.receipt.assignments).toBe(2);
    const equal = make({ [OLD]: "same", "other-old": "same" });
    expect(after(equal, success(equal, bindings).delta, "board_settings").perNetClassAssignments).toEqual({ [ACTIVE]: "same" });
    invalid(plan(make({ [OLD]: "first", "other-old": "second" }), bindings), "different classes");
  });
  test("prototype-like assignment source and target keys remain own JSON data", () => {
    const map = JSON.parse('{"__proto__":"class","constructor":"class"}') as Record<string, unknown>;
    const rows = [row("board_settings", { perNetClassAssignments: map })];
    const result = success(rows, [binding("__proto__", ACTIVE), binding("constructor", ACTIVE)]);
    expect(after(rows, result.delta, "board_settings").perNetClassAssignments).toEqual({ [ACTIVE]: "class" });
    const target = "__proto__", result2 = planNetReferenceRebind({ designId: DESIGN, rows: [row("board_settings", { perNetClassAssignments: { [OLD]: "class" } })],
      bindings: [binding(OLD, target)], activeIds: new Set([target]), judge: () => null });
    expect(result2.ok).toBe(true);
    if (!result2.ok) throw new Error("expected prototype-safe plan");
    const value = result2.delta.rows[0]!.fields[0]!.after;
    expect(value.exists && Object.prototype.hasOwnProperty.call(value.value, "__proto__")).toBe(true);
    expect(JSON.stringify(value.exists && value.value)).toBe('{"__proto__":"class"}');
  });
  test("unparsed array entries, unknown scopes and unrelated malformed known fields remain exact", () => {
    const raw = { lengthMatchGroups: [null, 1, "future", { future: "row" }, { id: "unrelated-bad", netIds: [null, 1] }, { id: "length", netIds: [OLD] }],
      diffPairs: [{ id: "bad", pNetId: null, nNetId: "unrelated" }, { id: "pair", pNetId: OLD, nNetId: OTHER }],
      drcRules: [{ id: "rule", scopes: [{ kind: "net", netIds: [OLD] }, { kind: "net", netIds: null }, { kind: "future", data: [OLD] }] }] };
    const rows = [row("board_settings", raw)], result = success(rows), next = after(rows, result.delta, "board_settings");
    expect(next).toEqual({ ...raw, lengthMatchGroups: [...raw.lengthMatchGroups.slice(0, -1), { id: "length", netIds: [ACTIVE] }],
      diffPairs: [raw.diffPairs[0], { id: "pair", pNetId: ACTIVE, nNetId: OTHER }], drcRules: [{ id: "rule", scopes: [{ kind: "net", netIds: [ACTIVE] }, ...raw.drcRules[0]!.scopes.slice(1)] }] });
  });
  test("large stored reference arrays traverse and map without function argument spread", () => {
    const netIds = Array.from({ length: 150_000 }, () => "untouched"); netIds[0] = OLD;
    const rows = [row("board_settings", { lengthMatchGroups: [{ id: "large", netIds }] })], authored = rows[0]!.payloadJson;
    const result = success(rows);
    expect(after(rows, result.delta, "board_settings")).toEqual({ lengthMatchGroups: [{ id: "large", netIds: [ACTIVE, "untouched"] }] });
    expect(result.receipt.lengthGroups).toBe(1); expect(rows[0]!.payloadJson).toBe(authored);
  });
});

describe("planner validation refuses before any observable mutation", () => {
  test.each([undefined, null, {}, [], Array.from({ length: 501 }, () => binding(OLD, ACTIVE)), [null], [1],
    [{}], [{ fromNetId: OLD }], [{ toNetId: ACTIVE }], [binding(" ", ACTIVE)], [binding(OLD, " ")], [binding(null, ACTIVE)],
    [binding(null, ACTIVE, " ")], [{ ...binding(OLD, ACTIVE), fromNetName: 7 }], [binding(ACTIVE, OTHER)],
    [binding(OLD, ACTIVE), binding(OLD, null, "ignored")], [binding(null, ACTIVE, "Hint"), binding(null, OTHER, "Hint")]].map((bindings) => ({ bindings })))("rejects malformed bindings %#", ({ bindings }) => {
    invalid(planNetReferenceRebind({ designId: DESIGN, activeIds, judge, rows: [], bindings }), "bindings");
  });
  test("distinct ID/hint keys and exact case/whitespace are not duplicate sources; 500 bindings allowed", () => {
    const bindings = [binding("same", ACTIVE), binding(null, ACTIVE, "same"), binding(null, ACTIVE, "Same"), binding(null, ACTIVE, " same ")];
    expect(success([], bindings).receipt).toEqual(emptyReceipt());
    expect(success([], Array.from({ length: 500 }, (_, index) => binding(`source-${index}`, null))).delta.rows).toEqual([]);
  });
  test("judge target refusal is returned verbatim with binding field path", () => {
    const result = plan([], [binding(OLD, "pending:0")]);
    expect(result).toEqual({ ok: false, result: danglingReference("bindings[0].toNetId", "pending:0", "pending") });
    invalid(planNetReferenceRebind({ designId: DESIGN, bindings: [binding(OLD, "inactive")], activeIds, judge: () => null, rows: [] }), "target must be active");
  });
  test("sparse bindings cannot skip required entry validation", () => {
    invalid(plan([], new Array(1)), "bindings[0]");
    const sparse = [binding(OLD, ACTIVE), , binding("other-old", null)];
    invalid(plan([], sparse), "bindings[1]");
  });
  test("required binding fields must be own data; null-prototype records and extra keys remain valid", () => {
    const inheritedBoth: unknown = Object.create(binding(OLD, ACTIVE));
    const inheritedTarget: unknown = Object.assign(Object.create({ toNetId: ACTIVE }), { fromNetId: OLD });
    invalid(plan([], [inheritedBoth]), ".fromNetId");
    invalid(plan([], [inheritedTarget]), ".toNetId");
    const explicit: unknown = Object.assign(Object.create(null), binding(OLD, ACTIVE), { extension: "ignored" });
    expect(success([], [explicit]).delta.rows).toEqual([]);
  });
  test.each(["bad-json", "nonobject", "missing-id", "blank-id", "duplicate-id", "netId", "netName", "foreign-row", "duplicate-row"])("rejects malformed copper %s", (kind) => {
    let rows = [row("trace", { id: "trace", netId: OLD })];
    if (kind === "bad-json") rows = [{ ...rows[0]!, payloadJson: "{broken" }];
    if (kind === "nonobject") rows = [row("trace", [])];
    if (kind === "missing-id") rows = [row("trace", { netId: OLD })];
    if (kind === "blank-id") rows = [row("trace", { id: " ", netId: OLD })];
    if (kind === "duplicate-id") rows.push(row("trace", { id: "trace", netId: "other" }, "second"));
    if (kind === "netId") rows = [row("trace", { id: "trace", netId: 7 })];
    if (kind === "netName") rows = [row("trace", { id: "trace", netId: OLD, netName: false })];
    if (kind === "foreign-row") rows = [{ ...rows[0]!, designId: "other" }];
    if (kind === "duplicate-row") rows.push(rows[0]!);
    const before = JSON.stringify(rows); expect(plan(rows).ok).toBe(false); expect(JSON.stringify(rows)).toBe(before);
  });
  test.each(["perNetClassAssignments", "lengthMatchGroups", "diffPairs", "drcRules"])("malformed top-level %s refuses, absent sections stay absent", (section) => {
    for (const malformed of [null, 7, "future"]) invalid(plan([row("board_settings", { [section]: malformed })]), section);
    expect(success([row("board_settings", { unrelated: true })]).delta.rows).toEqual([]);
  });
  test.each([
    { lengthMatchGroups: [{ id: "length", netIds: [OLD, null] }] },
    { lengthMatchGroups: [{ id: "length", netIds: OLD }] },
    { lengthMatchGroups: [{ netIds: [OLD] }] },
    { lengthMatchGroups: [{ id: "length", netIds: [OLD] }, { id: "length", future: true }] },
    { diffPairs: [{ id: "pair", pNetId: OLD }] },
    { drcRules: [{ id: "rule", scopes: { kind: "net", netIds: [OLD] } }] },
    { drcRules: [{ id: "rule", scopes: [{ kind: "net", netIds: [OLD, false] }] }] },
    { drcRules: [{ id: "rule", scopes: [{ kind: "future", netIds: [OLD] }] }] },
    { perNetClassAssignments: { [OLD]: { malformed: true } } },
  ])("affected malformed raw declaration refuses instead of disappearing %#", (payload) => {
    const rows = [row("board_settings", payload)], before = JSON.stringify(rows);
    expect(plan(rows).ok).toBe(false); expect(JSON.stringify(rows)).toBe(before);
  });
  test("multiple board rows and globally duplicate copper payload IDs refuse", () => {
    invalid(plan([row("board_settings", {}, "one"), row("board_settings", {}, "two")]), "more than one");
    invalid(plan([row("trace", { id: "same", netId: OLD }), row("via", { id: "same", netId: OLD })]), "globally unique");
  });
  test("malformed declared zone enabled refuses clear but stays opaque when rebinding to active", () => {
    for (const enabled of [null, "future", 0]) {
      const rows = [row("zone", { id: "zone", netId: OLD, enabled })], before = JSON.stringify(rows);
      invalid(plan(rows, [binding(OLD, null)]), ".enabled");
      expect(after(rows, success(rows).delta, "zone")).toMatchObject({ netId: ACTIVE, enabled });
      expect(JSON.stringify(rows)).toBe(before);
    }
  });
  test.each(["trace", "board_settings"])("numeric overflow in raw %s refuses before serialization can alter data", (kind) => {
    const payloadJson = kind === "trace" ? `{"id":"trace","netId":${JSON.stringify(OLD)},"geometry":{"unknown":1e999}}` :
      `{"lengthMatchGroups":[{"id":"length","netIds":[${JSON.stringify(OLD)}],"unknown":1e999}]}`;
    const rows = [{ ...row(kind, {}), payloadJson }], before = JSON.stringify(rows);
    invalid(plan(rows), `${kind}[${JSON.stringify(kind)}]: payload contains a JSON number whose decimal value cannot be preserved`);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
