// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NetIdentityActivityBadge } from "./NetIdentityActivityBadge";
import { useNetIdentityActivityStore } from "./net-identity-activity-store";

let root: Root, host: HTMLDivElement, scope: string;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); root = createRoot(host); scope = crypto.randomUUID();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
function append(backend: string, designId: string, revision: number) {
  useNetIdentityActivityStore.getState().append({ scope: backend, designId, revision, source: "command" }, [{
    kind: "merge", survivorNetId: "one", survivorName: "Signal", hasDependents: false, retired: [],
  }]);
}
it("counts only the coordinator's backend/design and clears on scoped markRead", async () => {
  append(scope, "a", 1); append(scope, "a", 2); append(scope, "b", 1); append("other", "a", 1);
  await act(async () => root.render(<NetIdentityActivityBadge scope={scope} designId="a" />));
  expect(host.querySelector('[aria-label="2 unread net changes"]')?.textContent).toBe("Nets 2");
  expect(host.innerHTML).toContain("text-status-warning");
  expect(host.innerHTML).not.toContain("text-status-danger");
  await act(async () => useNetIdentityActivityStore.getState().markRead(scope, "a"));
  expect(host.textContent).toBe("");
  await act(async () => root.render(<NetIdentityActivityBadge scope={scope} designId="b" />));
  expect(host.querySelector('[aria-label="1 unread net changes"]')).not.toBeNull();
});
it("has no badge for absent scope/design or an unobserved design", async () => {
  append(scope, "a", 1);
  for (const props of [{}, { scope }, { designId: "a" }, { scope, designId: "new" }]) {
    await act(async () => root.render(<NetIdentityActivityBadge {...props} />));
    expect(host.textContent).toBe("");
  }
});
