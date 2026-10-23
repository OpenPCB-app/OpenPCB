// @vitest-environment happy-dom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesignerNetIdentityStatus, DesignerPcbProjection } from "../../../../sdks/designer";
import { DesignerDrcView } from "../components/DesignerDrcView";
import { useDrcStore } from "../pcb/drc/drc-store";

const mocks = vi.hoisted(() => ({ api: { getNetIdentity: vi.fn(), getPcbProjection: vi.fn(), getDrcResult: vi.fn() } }));
vi.mock("../api", () => ({ createDesignerApi: () => mocks.api }));
vi.mock("../pcb/drc/use-drc-run", () => ({ useDrcRun: () => ({ start: vi.fn(), cancel: vi.fn() }) }));
vi.mock("../pcb/use-pcb-design-rules-dialog", () => ({ usePcbDesignRulesDialog: () => ({ available: false, open: vi.fn(), dialog: null }) }));
let root: Root, host: HTMLDivElement, props: ComponentProps<typeof DesignerDrcView>, serverRevision: number;
const active = "net:abcdefghij:1";
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); useDrcStore.getState().clear();
  serverRevision = 7; mocks.api.getDrcResult.mockResolvedValue(null);
  mocks.api.getNetIdentity.mockImplementation(async () => ({ revision: serverRevision, status: "active", mode: "durable", origin: "native",
    historiesArchived: null, lastError: null, orphanedCopperCount: 1, inertRuleReferenceCount: 0, exportBlocked: true,
    groups: [{ netId: "old", netName: "Old", reason: "retired", successorNetIds: [active], suggestedNetId: active,
      candidateNetIds: [active], copper: { traceIds: ["t"], viaIds: [], zoneIds: [], freePadIds: [] }, disabledZoneIds: [], rules: [] }],
  }) as DesignerNetIdentityStatus);
  mocks.api.getPcbProjection.mockImplementation(async () => ({ designId: "a", revision: serverRevision, netNames: { [active]: "Signal" } }) as DesignerPcbProjection);
  host = document.createElement("div"); root = createRoot(host);
  props = { moduleId: "designer", designId: "a", revision: 7, commandScope: crypto.randomUUID(), onShowViolation: vi.fn(),
    netIdentityActions: { dispatchCommand: vi.fn(), onObserved: vi.fn(async (_id, revision) => {
      props = { ...props, revision }; root.render(<DesignerDrcView {...props} />);
    }) } };
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<DesignerDrcView {...props} />));
const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent === label)!;
const refresh = () => act(async () => button("Refresh identity status and active nets").click());

it("recovers a failed PCB read without a new command or report rehydration", async () => {
  mocks.api.getPcbProjection.mockRejectedValueOnce(new Error("PCB offline"));
  await render();
  expect(host.textContent).toContain("Active nets unavailable: PCB offline");
  expect(button("Accept all suggestions").disabled).toBe(true);
  await refresh();
  expect(button("Accept all suggestions").disabled).toBe(false);
  expect(mocks.api.getPcbProjection).toHaveBeenCalledTimes(2);
  expect(mocks.api.getDrcResult).toHaveBeenCalledTimes(1);
  expect(props.netIdentityActions!.dispatchCommand).not.toHaveBeenCalled();
});
it("observes a newer read revision and reuses its projection instead of hydrating stale DRC", async () => {
  await render(); serverRevision = 8; await refresh();
  expect(props.netIdentityActions!.onObserved).toHaveBeenCalledExactlyOnceWith("a", 8);
  expect(props.revision).toBe(8); expect(button("Accept all suggestions").disabled).toBe(false);
  expect(mocks.api.getPcbProjection).toHaveBeenCalledTimes(2);
  expect(mocks.api.getNetIdentity).toHaveBeenCalledTimes(2);
  expect(mocks.api.getDrcResult).toHaveBeenCalledTimes(1);
});
it("keeps identity controls outside stale DRC opacity and reloads labels on revision change", async () => {
  useDrcStore.getState().setReport({ designId: "a", revision: 6, violations: [], summary: { errors: 0, warnings: 0, infos: 0 }, countsByCode: {} });
  await render();
  expect(host.querySelector('[aria-label="Net identity"]')?.closest(".opacity-60")).toBeNull();
  expect(host.textContent).toContain("Previous DRC report");
  serverRevision = 8; props = { ...props, revision: 8 }; await render();
  expect(mocks.api.getPcbProjection).toHaveBeenCalledTimes(2);
  expect(useDrcStore.getState().report?.revision).toBe(6);
  expect(mocks.api.getDrcResult).not.toHaveBeenCalled();
});
