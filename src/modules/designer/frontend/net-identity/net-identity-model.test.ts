import { describe, expect, it } from "vitest";
import type { DesignerNetIdentityStatus, DesignerNetReferenceGroup, DesignerPcbProjection } from "../../../../sdks/designer";
import { activeNetChoices, bindingForGroup, inertAssignmentBindings, isRuleOnlyGroup, NET_REPAIR_LIMIT_MESSAGE,
  referenceGroupKey, repairLimitError, repairReadiness, suggestionBindings } from "./net-identity-model";

const active = "net:abcdefghij:1";
const group = (patch: Partial<DesignerNetReferenceGroup> = {}): DesignerNetReferenceGroup => ({
  netId: "retired", netName: "Signal", reason: "retired", successorNetIds: [active], suggestedNetId: active,
  candidateNetIds: [active], copper: { traceIds: [], viaIds: [], zoneIds: [], freePadIds: [] },
  disabledZoneIds: [], rules: [{ kind: "netClassAssignment" }], ...patch,
});
const status = { status: "active", mode: "durable", revision: 7 } as DesignerNetIdentityStatus;
const projection = { designId: "a", revision: 7, netNames: { [active]: "Signal", "nc:pin": "Lone", "pending:0": "Signal" } } as DesignerPcbProjection;

describe("explicit net reference repair model", () => {
  it("keeps nonnull ID authoritative; null sources preserve exact nonblank hint spelling", () => {
    expect(bindingForGroup(group(), active)).toEqual({ fromNetId: "retired", toNetId: active });
    const hinted = group({ netId: null, netName: " Signal " });
    expect(bindingForGroup(hinted, null)).toEqual({ fromNetId: null, fromNetName: " Signal ", toNetId: null });
    expect(referenceGroupKey(hinted)).not.toBe(referenceGroupKey(group({ netId: null, netName: "Signal" })));
    expect(bindingForGroup(group({ netId: null, netName: "  " }), null)).toBeNull();
    expect(bindingForGroup(group({ netId: null, netName: null }), null)).toBeNull();
  });
  it("accepts only an explicit active suggested ID, never candidate count or name matches", () => {
    const groups = [group(), group({ netId: "unknown", suggestedNetId: "inactive" }), group({ netId: "other", suggestedNetId: null })];
    expect(suggestionBindings(groups, new Set([active]))).toEqual([{ fromNetId: "retired", toNetId: active }]);
    expect(suggestionBindings(groups, new Set())).toEqual([]);
  });
  it("drops only rule-only groups with no copper of any kind, including disabled zones", () => {
    expect(isRuleOnlyGroup(group())).toBe(true);
    for (const key of ["traceIds", "viaIds", "zoneIds", "freePadIds"] as const) {
      expect(isRuleOnlyGroup(group({ copper: { ...group().copper, [key]: ["copper"] } }))).toBe(false);
    }
    expect(isRuleOnlyGroup(group({ disabledZoneIds: ["disabled"] }))).toBe(false);
    expect(isRuleOnlyGroup(group({ rules: [] }))).toBe(false);
    expect(inertAssignmentBindings([group(), group({ disabledZoneIds: ["disabled"] })]))
      .toEqual([{ fromNetId: "retired", toNetId: null }]);
  });
  it("permits 500 bindings and refuses 501 without truncating", () => {
    const groups = Array.from({ length: 501 }, (_, i) => group({ netId: `old-${i}` }));
    const bindings = suggestionBindings(groups, new Set([active]));
    expect(bindings).toHaveLength(501);
    expect(repairLimitError(bindings.slice(0, 500))).toBeNull();
    expect(repairLimitError(bindings)).toBe(NET_REPAIR_LIMIT_MESSAGE);
    expect(inertAssignmentBindings(groups)).toHaveLength(501);
  });
  it("requires active durable status and matching current design and revision", () => {
    expect(repairReadiness(status, projection, "a", 7)).toBeNull();
    expect(repairReadiness(status, projection, "b", 7)).not.toBeNull();
    expect(repairReadiness(status, projection, "a", null)).not.toBeNull();
    expect(repairReadiness({ ...status, revision: 6 }, projection, "a", 7)).not.toBeNull();
    expect(repairReadiness(status, { ...projection, revision: 6 }, "a", 7)).not.toBeNull();
    expect(repairReadiness({ ...status, status: "legacy_restored", mode: "legacy" }, projection, "a", 7)).not.toBeNull();
    expect(activeNetChoices(projection)).toEqual([{ id: active, name: "Signal" }, { id: "nc:pin", name: "Lone" }]);
  });
});
