import { describe, expect, test } from "bun:test";
import type { DesignerNetDependents, DesignerNetIdentityOutcome } from "../../../sdks/designer";
import { parseNetIdentityOutcome } from "../../../modules/designer/backend/net-identity/outcome-parse";
import { parseDispatchResultJson } from "../../../modules/designer/backend/results";

function dependents(overrides: Partial<DesignerNetDependents> = {}): DesignerNetDependents {
  return { traces: 0, vias: 0, zones: 0, freePads: 0, netClassAssignment: false,
    lengthGroupIds: [], diffPairIds: [], drcRuleIds: [], ...overrides };
}

function outcome(): DesignerNetIdentityOutcome {
  return { events: [
    { kind: "split", netId: "net:a:1", netName: "VCC", keptPinCount: 2, hasDependents: true,
      newNets: [{ netId: "nc:pin-2", netName: "Net_2", pinCount: 1 }],
      dependents: dependents({ traces: 3, vias: 2, zones: 1, freePads: 4, netClassAssignment: true,
        lengthGroupIds: ["length-2", "length-1"], diffPairIds: ["pair"], drcRuleIds: ["rule"] }) },
    { kind: "merge", survivorNetId: "net:a:3", survivorName: "GND", hasDependents: false,
      retired: [{ netId: "net:a:4", netName: "Net_4", pinCount: 0, dependents: dependents() }] },
    { kind: "reconfigure", hasDependents: false,
      predecessors: [
        { netId: "net:a:5", netName: "KEPT", retired: false, dependents: dependents({ traces: 1 }) },
        { netId: "net:a:6", netName: "LOST", retired: true, dependents: dependents() },
      ], successors: [{ netId: "net:a:5", netName: "KEPT" }, { netId: "net:a:7", netName: "NEW" }] },
    { kind: "removed", netId: "net:a:8", netName: "REMOVED", hasDependents: true,
      dependents: dependents({ drcRuleIds: ["rule"] }) },
  ] };
}

function rawOutcome(): Record<string, unknown> {
  return structuredClone(outcome()) as unknown as Record<string, unknown>;
}

function rawEvents(value: Record<string, unknown>): Record<string, unknown>[] {
  return value.events as Record<string, unknown>[];
}

const baseResult = { ok: true as const, revision: 17, createdEntityId: "part", legality: { refused: 0, warnings: 3 } };

function replay(value: unknown) {
  return parseDispatchResultJson(JSON.stringify({ ...baseResult, netIdentity: value }));
}

describe("net identity result metadata parsing", () => {
  test("all four event kinds replay with exact order and existing legality", () => {
    expect(parseNetIdentityOutcome(outcome())).toEqual(outcome());
    expect(replay(outcome())).toEqual({ ...baseResult, idempotent: true, netIdentity: outcome() });
    expect(parseNetIdentityOutcome({ events: [] })).toEqual({ events: [] });
    expect(replay({ events: [] })).toEqual({ ...baseResult, idempotent: true, netIdentity: { events: [] } });
  });

  test("old results and malformed optional outcomes retain legacy idempotent success", () => {
    expect(parseDispatchResultJson(JSON.stringify(baseResult))).toEqual({ ...baseResult, idempotent: true });
    for (const value of [undefined, null, false, [], {}, { events: null }, { events: [{}] }, { events: [{ kind: "future" }] }]) {
      expect(parseNetIdentityOutcome(value)).toBeUndefined();
      expect(replay(value)).toEqual({ ...baseResult, idempotent: true });
    }
    expect(parseDispatchResultJson(JSON.stringify({ ok: true, revision: 2 })))
      .toEqual({ ok: true, revision: 2, createdEntityId: null, idempotent: true });
    expect(parseDispatchResultJson(JSON.stringify({ ok: false, code: "PCB_PLACEMENT_NOT_FOUND", placementId: "missing", netIdentity: outcome() })))
      .toEqual({ ok: false, code: "PCB_PLACEMENT_NOT_FOUND", placementId: "missing" });
  });

  test("unknown properties strip at every record depth", () => {
    const value = rawOutcome();
    const addUnknown = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      for (const child of Object.values(node)) addUnknown(child);
      if (!Array.isArray(node)) Object.assign(node, { future: { opaque: true } });
    };
    addUnknown(value);
    expect(parseNetIdentityOutcome(value)).toEqual(outcome());
    expect(replay(value)).toEqual({ ...baseResult, idempotent: true, netIdentity: outcome() });
  });

  test("accepted output clones every nested object and array", () => {
    const raw = outcome();
    const parsed = parseNetIdentityOutcome(raw)!;
    const assertDetached = (first: unknown, second: unknown): void => {
      if (!first || typeof first !== "object") return;
      expect(first).not.toBe(second);
      for (const key of Object.keys(first)) assertDetached(
        (first as Record<string, unknown>)[key], (second as Record<string, unknown>)[key],
      );
    };
    assertDetached(raw, parsed);
    const split = parsed.events[0]!;
    if (split.kind !== "split") throw new Error("Expected split fixture");
    split.dependents.lengthGroupIds.push("new");
    split.newNets[0]!.netName = "changed";
    expect(raw).toEqual(outcome());
  });

  test("every count must be finite, safe, integer and nonnegative", () => {
    for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null, undefined]) {
      for (const field of ["traces", "vias", "zones", "freePads"]) {
        const value = rawOutcome();
        (rawEvents(value)[0]!.dependents as Record<string, unknown>)[field] = bad;
        expect(parseNetIdentityOutcome(value)).toBeUndefined();
        expect(replay(value)).toEqual({ ...baseResult, idempotent: true });
      }
      const value = rawOutcome();
      rawEvents(value)[0]!.keptPinCount = bad;
      expect(parseNetIdentityOutcome(value)).toBeUndefined();
      rawEvents(value)[0]!.keptPinCount = 0;
      (rawEvents(value)[0]!.newNets as Record<string, unknown>[])[0]!.pinCount = bad;
      expect(parseNetIdentityOutcome(value)).toBeUndefined();
      const merged = rawOutcome();
      (rawEvents(merged)[1]!.retired as Record<string, unknown>[])[0]!.pinCount = bad;
      expect(parseNetIdentityOutcome(merged)).toBeUndefined();
    }
  });

  test("dependent ID arrays require unique nonblank strings and a real boolean", () => {
    for (const field of ["lengthGroupIds", "diffPairIds", "drcRuleIds"]) {
      for (const bad of [null, "ids", [null], [1], [""], ["  "], ["id", "id"], new Array(1)]) {
        const value = rawOutcome();
        (rawEvents(value)[0]!.dependents as Record<string, unknown>)[field] = bad;
        expect(parseNetIdentityOutcome(value)).toBeUndefined();
      }
    }
    for (const bad of [null, "true", 1, undefined]) {
      const value = rawOutcome();
      (rawEvents(value)[0]!.dependents as Record<string, unknown>).netClassAssignment = bad;
      expect(parseNetIdentityOutcome(value)).toBeUndefined();
    }
  });

  test("event names, IDs, member arrays and nested records validate wholly", () => {
    const patches = [
      { netId: " " }, { netName: "" }, { netName: 5 }, { newNets: null }, { newNets: [null] },
      { newNets: [{ netId: "new", netName: " ", pinCount: 1 }] }, { dependents: null },
    ];
    for (const patch of patches) {
      const value = rawOutcome();
      Object.assign(rawEvents(value)[0]!, patch);
      expect(parseNetIdentityOutcome(value)).toBeUndefined();
    }
    for (const [index, patch] of [
      [1, { survivorNetId: "" }], [1, { survivorName: " " }], [1, { retired: [{}] }],
      [2, { predecessors: [{ netId: "a", netName: "A", retired: "true", dependents: dependents() }] }],
      [2, { successors: [{ netId: "", netName: "A" }] }], [2, { successors: null }],
      [3, { dependents: {} }], [3, { netName: "\n" }],
    ] as const) {
      const value = rawOutcome();
      Object.assign(rawEvents(value)[index]!, patch);
      expect(parseNetIdentityOutcome(value)).toBeUndefined();
    }
    expect(parseNetIdentityOutcome({ events: new Array(1) })).toBeUndefined();
  });

  test("impossible repeated IDs within each member list reject", () => {
    for (const [index, key] of [[0, "newNets"], [1, "retired"], [2, "predecessors"], [2, "successors"]] as const) {
      const value = rawOutcome();
      const event = rawEvents(value)[index]!;
      const members = event[key] as unknown[];
      event[key] = [members[0], members[0]];
      expect(parseNetIdentityOutcome(value)).toBeUndefined();
    }
    const split = rawOutcome();
    (rawEvents(split)[0]!.newNets as Record<string, unknown>[])[0]!.netId = "net:a:1";
    expect(parseNetIdentityOutcome(split)).toBeUndefined();
    const merge = rawOutcome();
    (rawEvents(merge)[1]!.retired as Record<string, unknown>[])[0]!.netId = "net:a:3";
    expect(parseNetIdentityOutcome(merge)).toBeUndefined();
  });

  test("hasDependents exactly matches predecessor retirement semantics", () => {
    for (let index = 0; index < 4; index += 1) {
      const value = rawOutcome();
      const event = rawEvents(value)[index]!;
      event.hasDependents = !event.hasDependents;
      expect(parseNetIdentityOutcome(value)).toBeUndefined();
      event.hasDependents = "true";
      expect(parseNetIdentityOutcome(value)).toBeUndefined();
    }
    const value = rawOutcome();
    const events = rawEvents(value);
    events[0]!.dependents = dependents();
    events[0]!.hasDependents = false;
    (events[1]!.retired as Record<string, unknown>[])[0]!.dependents = dependents({ netClassAssignment: true });
    events[1]!.hasDependents = true;
    (events[2]!.predecessors as Record<string, unknown>[])[1]!.dependents = dependents({ freePads: 1 });
    events[2]!.hasDependents = true;
    expect(parseNetIdentityOutcome(value) as unknown).toEqual(value);
    events[3]!.dependents = dependents();
    expect(parseNetIdentityOutcome(value)).toBeUndefined();
  });
});
