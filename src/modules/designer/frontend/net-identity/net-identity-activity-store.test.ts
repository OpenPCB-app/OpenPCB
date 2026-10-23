import { describe, expect, it } from "vitest";
import type { DesignerNetDependents, DesignerNetIdentityEvent } from "../../../../sdks/designer";
import { netIdentityEventMessage } from "./event-message";
import { createNetIdentityActivityStore, NET_IDENTITY_ACTIVITY_LIMIT,
  selectNetIdentityActivity, selectNetIdentityUnreadCount } from "./net-identity-activity-store";

const context = { scope: "backend", designId: "design", revision: 1, source: "command" as const };
const dependents = (): DesignerNetDependents => ({ traces: 1, vias: 0, zones: 0, freePads: 0,
  netClassAssignment: false, lengthGroupIds: ["length"], diffPairIds: [], drcRuleIds: [] });
const events = (): DesignerNetIdentityEvent[] => [
  { kind: "split", netId: "a", netName: "Signal", keptPinCount: 2, hasDependents: false,
    newNets: [{ netId: "b", netName: "Branch", pinCount: 1 }], dependents: dependents() },
  { kind: "merge", survivorNetId: "a", survivorName: "Signal", hasDependents: true,
    retired: [{ netId: "b", netName: "Branch", pinCount: 1, dependents: dependents() }] },
  { kind: "reconfigure", hasDependents: true,
    predecessors: [{ netId: "a", netName: "Signal", retired: false, dependents: dependents() }],
    successors: [{ netId: "c", netName: "Rewired" }] },
  { kind: "removed", netId: "a", netName: "Signal", hasDependents: true, dependents: dependents() },
];

describe("session net identity activity", () => {
  it("records every event in response order with real names and stable event indices", () => {
    const store = createNetIdentityActivityStore();
    const added = store.getState().append(context, events());
    expect(added.map((entry) => [entry.event.kind, entry.eventIndex, entry.source])).toEqual([
      ["split", 0, "command"], ["merge", 1, "command"], ["reconfigure", 2, "command"], ["removed", 3, "command"],
    ]);
    expect(added.map((entry) => netIdentityEventMessage(entry.event))).toEqual([
      "Net 'Signal' split; new nets: 'Branch'.", "Nets 'Branch' merged into 'Signal'.",
      "Nets 'Signal' reconfigured as 'Rewired'.", "Net 'Signal' removed.",
    ]);
    expect(selectNetIdentityUnreadCount("backend", "design")(store.getState())).toBe(4);
  });

  it("clones and deeply freezes event data without freezing or retaining caller data", () => {
    const store = createNetIdentityActivityStore(), original = events();
    const entry = store.getState().append(context, original)[0]!;
    const split = original[0];
    if (split?.kind !== "split" || entry.event.kind !== "split") throw new Error("Expected split");
    split.newNets[0]!.netName = "Changed";
    split.dependents.lengthGroupIds.push("later");
    expect(entry.event.newNets[0]!.netName).toBe("Branch");
    expect(entry.event.dependents.lengthGroupIds).toEqual(["length"]);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.event.newNets[0])).toBe(true);
    expect(Object.isFrozen(entry.event.dependents.lengthGroupIds)).toBe(true);
    expect(Object.isFrozen(original)).toBe(false);
  });

  it("scopes entries and unread counts by backend and design; markRead affects only its target", () => {
    const store = createNetIdentityActivityStore();
    for (const input of [context, { ...context, scope: "other" }, { ...context, designId: "other" }]) {
      store.getState().append(input, events());
    }
    store.getState().markRead("backend", "design");
    expect(selectNetIdentityUnreadCount("backend", "design")(store.getState())).toBe(0);
    expect(selectNetIdentityUnreadCount("other", "design")(store.getState())).toBe(4);
    expect(selectNetIdentityUnreadCount("backend", "other")(store.getState())).toBe(4);
    store.getState().append({ ...context, revision: 2, source: "undo" }, events());
    expect(selectNetIdentityUnreadCount("backend", "design")(store.getState())).toBe(4);
    const selector = selectNetIdentityActivity("backend", "design");
    expect(selector(store.getState())).toBe(selector(store.getState()));
    const empty = selectNetIdentityActivity("missing", "missing");
    expect(empty(store.getState())).toBe(empty(store.getState()));
  });

  it("dedupes revision/event index regardless of history direction, including after markRead", () => {
    const store = createNetIdentityActivityStore();
    store.getState().append(context, events());
    store.getState().markRead(context.scope, context.designId);
    expect(store.getState().append({ ...context, source: "redo" }, events())).toEqual([]);
    expect(store.getState().entries).toHaveLength(4);
    expect(selectNetIdentityUnreadCount(context.scope, context.designId)(store.getState())).toBe(0);
  });

  it("caps the global list at 200 and bounds retry dedup to that retained window", () => {
    const store = createNetIdentityActivityStore(), event = events()[0]!;
    for (let revision = 0; revision < 205; revision++) {
      store.getState().append({ ...context, revision, scope: revision % 2 ? "other" : "backend" }, [event]);
    }
    expect(store.getState().entries).toHaveLength(NET_IDENTITY_ACTIVITY_LIMIT);
    expect(store.getState().entries[0]!.revision).toBe(5);
    expect(Object.values(store.getState().byDesign).flat()).toHaveLength(200);
    expect(selectNetIdentityUnreadCount("backend", "design")(store.getState())).toBe(100);
    expect(selectNetIdentityUnreadCount("other", "design")(store.getState())).toBe(100);
    expect(store.getState().append({ ...context, revision: 204 }, [event])).toEqual([]);
    expect(store.getState().append({ ...context, revision: 0 }, [event])).toHaveLength(1);
    expect(store.getState().entries).toHaveLength(200);
    expect(store.getState().entries.at(-1)!.revision).toBe(0);
  });

  it("returns all newly observed events even when a single response exceeds the display cap", () => {
    const store = createNetIdentityActivityStore();
    expect(store.getState().append(context, Array.from({ length: 205 }, () => events()[0]!))).toHaveLength(205);
    expect(store.getState().entries).toHaveLength(200);
    expect(store.getState().entries[0]!.eventIndex).toBe(5);
  });
});
