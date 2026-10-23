// @vitest-environment happy-dom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignerNetIdentityStatus, DesignerNetReferenceGroup, DesignerPcbProjection } from "../../../../sdks/designer";
import { DesignerApiProblemError } from "../api";
import { NetIdentityPanel } from "./NetIdentityPanel";
import { useNetIdentityActivityStore, selectNetIdentityUnreadCount } from "./net-identity-activity-store";

const confirm = vi.hoisted(() => vi.fn());
vi.mock("../../../../shared/frontend/ui/dialog-host-store", () => ({ confirmDialog: confirm }));
const active = "net:abcdefghij:1", old = "net:abcdefghij:9";
const group = (patch: Partial<DesignerNetReferenceGroup> = {}): DesignerNetReferenceGroup => ({
  netId: old, netName: "Old signal", reason: "retired", successorNetIds: [active], suggestedNetId: active,
  candidateNetIds: [active], copper: { traceIds: ["trace"], viaIds: [], freePadIds: [], zoneIds: ["enabled"] },
  disabledZoneIds: ["disabled"], rules: [], ...patch,
});
const status = (patch: Partial<DesignerNetIdentityStatus> = {}): DesignerNetIdentityStatus => ({
  revision: 7, status: "active", mode: "durable", origin: "legacy-migration", lastError: null, historiesArchived: 2,
  groups: [group()], orphanedCopperCount: 2, inertRuleReferenceCount: 0, exportBlocked: true, ...patch,
});
const pcb = (designId = "a", revision = 7) => ({ designId, revision,
  netNames: { [active]: "Signal", "nc:lone": "Lone", "pending:1": "Ignored pending" } }) as DesignerPcbProjection;
const receipt = { traces: 1, vias: 2, zones: 3, freePads: 4, assignments: 5, lengthGroups: 6, diffPairs: 7, drcRules: 8,
  removedRules: ["rule"], removedDiffPairs: ["pair"], removedLengthGroups: ["length"], disabledZones: ["zone"] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
let root: Root, host: HTMLDivElement, props: ComponentProps<typeof NetIdentityPanel>, server: DesignerNetIdentityStatus;
let api: { getNetIdentity: ReturnType<typeof vi.fn>; migrateNetIdentity: ReturnType<typeof vi.fn>; restoreNetIdentity: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  confirm.mockReset(); confirm.mockResolvedValue(true);
  server = status();
  api = { getNetIdentity: vi.fn(async () => server), migrateNetIdentity: vi.fn(async () => server), restoreNetIdentity: vi.fn(async () => server) };
  host = document.createElement("div"); root = createRoot(host);
  props = { api, scope: crypto.randomUUID(), designId: "a", revision: 7, projection: pcb(),
    dispatchCommand: vi.fn(async () => { server = status({ revision: 8, groups: [] }); return { ok: true, revision: 8, createdEntityId: null, netRebind: receipt }; }),
    onObserved: vi.fn(async (designId, revision) => { props = { ...props, revision }; root.render(<NetIdentityPanel {...props} />); }),
    refreshProjection: vi.fn(async () => { const projection = pcb(props.designId, server.revision); props = { ...props, projection };
      root.render(<NetIdentityPanel {...props} />); return projection; }),
  };
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const render = async () => { await act(async () => root.render(<NetIdentityPanel {...props} />)); };
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
const click = async (label: string) => { await act(async () => button(label).click()); };
const issue = (httpStatus: number, type = "other") => new DesignerApiProblemError(httpStatus, { status: httpStatus, type, title: "Refused", detail: "Cannot restore" });

describe("net identity panel", () => {
  it("shows status, exact provenance, enabled/disabled counts and active-ID choices without readiness claims", async () => {
    await render();
    expect(host.textContent).toContain("Status: active · durable · revision 7");
    expect(host.textContent).toContain("1 enabled zones · 1 disabled zones");
    expect(host.textContent).toContain("Source name: \"Old signal\"");
    expect(host.textContent).toContain(`Candidates: Signal (${active})`);
    const picker = host.querySelector<HTMLSelectElement>(`[aria-label="Active net for ${old}"]`)!;
    expect(picker.tagName).toBe("SELECT");
    expect(picker.value).toBe("");
    expect(picker.selectedOptions[0]!.textContent).toBe("Choose active net ID…");
    expect(picker.selectedOptions[0]!.disabled).toBe(true);
    expect([...picker.options].map((option) => option.value)).toEqual(["", active, "nc:lone"]);
    expect(picker.className).toContain("bg-surface-input");
    expect(host.textContent).toContain("DRC and manufacturing qualification remain separate");
    expect(host.textContent).not.toContain("manufacturing ready");
  });
  it("uses one workspace repair command, refreshes once and reports the full receipt", async () => {
    await render(); await click("Accept suggestion: Signal");
    expect(props.dispatchCommand).toHaveBeenCalledExactlyOnceWith({ type: "pcb_rebind_net_references", bindings: [{ fromNetId: old, toNetId: active }] });
    expect(props.onObserved).toHaveBeenCalledExactlyOnceWith("a", 8);
    expect(props.refreshProjection).toHaveBeenCalledExactlyOnceWith(8);
    expect(api.getNetIdentity).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Repair applied at revision 8");
    for (const text of ["Removed rules: rule", "Removed differential pairs: pair", "Removed length groups: length", "Disabled zones: zone"]) expect(host.textContent).toContain(text);
    expect(host.textContent).toContain("Identity references resolved");
  });
  it("manual selection binds the chosen active ID and clear preserves a null source's exact hint", async () => {
    server = status({ groups: [group({ netId: null, netName: " Hint " })] }); await render();
    await act(async () => {
      const picker = host.querySelector<HTMLSelectElement>('[aria-label^="Active net for "]')!;
      picker.value = "nc:lone"; picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Rebind references");
    expect(props.dispatchCommand).toHaveBeenCalledWith({ type: "pcb_rebind_net_references", bindings: [{ fromNetId: null, fromNetName: " Hint ", toNetId: "nc:lone" }] });
  });
  it("clear sends an explicit null target rather than guessing the suggested net", async () => {
    await render(); await click("Clear references");
    expect(props.dispatchCommand).toHaveBeenCalledWith({ type: "pcb_rebind_net_references", bindings: [{ fromNetId: old, toNetId: null }] });
  });
  it("does not treat candidate names or inactive suggestions as accepted targets", async () => {
    server = status({ groups: [group({ suggestedNetId: "inactive" })] }); await render();
    expect(button("Accept all suggestions").disabled).toBe(true);
    expect(host.textContent).not.toContain("Accept suggestion:");
  });
  it("bulk actions refuse more than 500 bindings with visible guidance", async () => {
    server = status({ groups: Array.from({ length: 501 }, (_, index) => group({ netId: `old-${index}`,
      copper: { traceIds: [], viaIds: [], zoneIds: [], freePadIds: [] }, disabledZoneIds: [], rules: [{ kind: "netClassAssignment" }] })) });
    await render();
    expect(button("Accept all suggestions").disabled).toBe(true);
    expect(button("Drop all inert assignments").disabled).toBe(true);
    expect(host.textContent).toContain("Choose at most 500 bindings per repair");
    await click("Accept all suggestions"); expect(props.dispatchCommand).not.toHaveBeenCalled();
  });
  it.each([null, pcb("other"), pcb("a", 6)])("requires a matching projection before enabling repair (%j)", async (projection) => {
    props = { ...props, projection }; await render();
    expect(button("Accept all suggestions").disabled).toBe(true);
    expect(button("Clear references").disabled).toBe(true);
  });
  it("an applied write with failed observation offers read-only retry and never repeats the mutation", async () => {
    await render(); api.getNetIdentity.mockRejectedValueOnce(new Error("status offline"));
    await click("Accept suggestion: Signal");
    expect(host.textContent).toContain("Applied; refresh failed: status offline");
    expect(host.textContent).toContain("Disabled zones: zone");
    await click("Retry refresh");
    expect(props.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(props.onObserved).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Applied; refresh failed");
  });
  it("a failed repair is visible and never refreshes or automatically retries", async () => {
    vi.mocked(props.dispatchCommand).mockRejectedValue(new Error("Revision changed"));
    await render(); await click("Accept suggestion: Signal");
    expect(host.textContent).toContain("Revision changed");
    expect(props.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(props.onObserved).not.toHaveBeenCalled();
  });
  it.each(["migration_failed", "legacy_restored", "unmigrated"] as const)("shows last error and migration retry for %s", async (state) => {
    server = status({ status: state, mode: "legacy", lastError: "Migration evidence unavailable" });
    await render(); expect(host.textContent).toContain("Migration evidence unavailable");
    expect(host.textContent).not.toContain("Restore original legacy backup");
    await click("Retry migration"); expect(api.migrateNetIdentity).toHaveBeenCalledExactlyOnceWith("a");
    expect(props.onObserved).toHaveBeenCalledTimes(1);
    expect(props.dispatchCommand).not.toHaveBeenCalled();
  });
  it("only active legacy-migration origin offers backup restore", async () => {
    server = status({ origin: "native" }); await render();
    expect(host.textContent).not.toContain("Restore original legacy backup");
  });
  it("restore first posts unconfirmed, then confirms only the exact discard-edits conflict", async () => {
    api.restoreNetIdentity.mockRejectedValueOnce(issue(409, "https://openpcb.dev/problems/net-identity-restore-discards-edits"))
      .mockImplementationOnce(async () => { server = status({ revision: 8, status: "legacy_restored", mode: "legacy" }); return server; });
    await render(); await click("Restore original legacy backup");
    expect(api.restoreNetIdentity.mock.calls).toEqual([["a", false], ["a", true]]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatchObject({ title: "Discard edits after migration?", confirmLabel: "Discard later edits and restore" });
    expect(props.onObserved).toHaveBeenCalledExactlyOnceWith("a", 8);
  });
  it.each([409, 422])("restore HTTP %s without the exact conflict type remains visible without retry", async (httpStatus) => {
    api.restoreNetIdentity.mockRejectedValue(issue(httpStatus));
    await render(); await click("Restore original legacy backup");
    expect(api.restoreNetIdentity).toHaveBeenCalledTimes(1); expect(confirm).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Cannot restore"); expect(props.onObserved).not.toHaveBeenCalled();
  });
  it("declining discard sends no confirmed restore", async () => {
    api.restoreNetIdentity.mockRejectedValue(issue(409, "https://openpcb.dev/problems/net-identity-restore-discards-edits")); confirm.mockResolvedValue(false);
    await render(); await click("Restore original legacy backup");
    expect(api.restoreNetIdentity).toHaveBeenCalledTimes(1); expect(props.onObserved).not.toHaveBeenCalled();
  });
  it("dismisses archived history once per scope/design session and lists scoped activity as read", async () => {
    const empty = { traces: 0, vias: 0, zones: 0, freePads: 0, netClassAssignment: false, lengthGroupIds: [], diffPairIds: [], drcRuleIds: [] };
    useNetIdentityActivityStore.getState().append({ scope: props.scope, designId: "a", revision: 6, source: "undo" },
      [{ kind: "removed", netId: "old", netName: "Deleted signal", hasDependents: true, dependents: empty }]);
    useNetIdentityActivityStore.getState().append({ scope: "other", designId: "a", revision: 6, source: "command" },
      [{ kind: "removed", netId: "other", netName: "Other backend", hasDependents: true, dependents: empty }]);
    await render(); expect(host.textContent).toContain("Revision 6 · undo"); expect(host.textContent).toContain("Deleted signal");
    expect(host.textContent).not.toContain("Other backend");
    expect(selectNetIdentityUnreadCount(props.scope, "a")(useNetIdentityActivityStore.getState())).toBe(0);
    await click("Dismiss archived history notice");
    await act(async () => root.unmount()); root = createRoot(host); await render();
    expect(host.textContent).not.toContain("histories were archived");
    props = { ...props, scope: "new-scope" }; await render();
    expect(host.textContent).toContain("histories were archived");
  });
  it("ignores a late old-design status and an old restore confirmation after switching", async () => {
    const first = deferred<DesignerNetIdentityStatus>(); api.getNetIdentity.mockReturnValueOnce(first.promise);
    await render(); props = { ...props, designId: "b", projection: pcb("b") }; server = status({ lastError: "Current design" }); await render();
    await act(async () => first.resolve(status({ lastError: "Late old design" })));
    expect(host.textContent).toContain("Current design"); expect(host.textContent).not.toContain("Late old design");
    const confirmation = deferred<boolean>(); confirm.mockReturnValue(confirmation.promise);
    api.restoreNetIdentity.mockRejectedValue(issue(409, "https://openpcb.dev/problems/net-identity-restore-discards-edits"));
    await click("Restore original legacy backup"); props = { ...props, designId: "c", projection: pcb("c") }; await render();
    await act(async () => confirmation.resolve(true));
    expect(api.restoreNetIdentity).toHaveBeenCalledTimes(1); expect(props.onObserved).not.toHaveBeenCalled();
  });
  it("refreshes status and active nets read-only and reconciles a newer server revision", async () => {
    await render(); server = status({ revision: 8 });
    await click("Refresh identity status and active nets");
    expect(props.refreshProjection).toHaveBeenCalledExactlyOnceWith();
    expect(props.onObserved).toHaveBeenCalledExactlyOnceWith("a", 8);
    expect(button("Accept all suggestions").disabled).toBe(false);
    expect(props.dispatchCommand).not.toHaveBeenCalled();
    expect(api.migrateNetIdentity).not.toHaveBeenCalled(); expect(api.restoreNetIdentity).not.toHaveBeenCalled();
  });
  it("keyed unmount before the first restore reply opens no stale confirmation", async () => {
    await act(async () => root.render(<NetIdentityPanel key="a" {...props} />));
    const pending = deferred<DesignerNetIdentityStatus>(); api.restoreNetIdentity.mockReturnValueOnce(pending.promise);
    await click("Restore original legacy backup");
    props = { ...props, designId: "b", projection: pcb("b") };
    await act(async () => root.render(<NetIdentityPanel key="b" {...props} />));
    await act(async () => pending.reject(issue(409, "https://openpcb.dev/problems/net-identity-restore-discards-edits")));
    expect(confirm).not.toHaveBeenCalled(); expect(api.restoreNetIdentity).toHaveBeenCalledTimes(1);
    expect(props.onObserved).not.toHaveBeenCalled();
  });
  it("keyed unmount while confirmation waits sends no confirmed restore", async () => {
    await act(async () => root.render(<NetIdentityPanel key="a" {...props} />));
    const pending = deferred<boolean>(); confirm.mockReturnValueOnce(pending.promise);
    api.restoreNetIdentity.mockRejectedValueOnce(issue(409, "https://openpcb.dev/problems/net-identity-restore-discards-edits"));
    await click("Restore original legacy backup");
    props = { ...props, scope: "other-backend" };
    await act(async () => root.render(<NetIdentityPanel key="other-backend" {...props} />));
    await act(async () => pending.resolve(true));
    expect(api.restoreNetIdentity).toHaveBeenCalledTimes(1); expect(props.onObserved).not.toHaveBeenCalled();
  });
});
