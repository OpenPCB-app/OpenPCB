// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  getCloudProjection,
  listPersonalWorkspaceDesigns,
  type CloudProjection,
} from "@/cloud/queries";
import { CloudDesignBrowser } from "./CloudDesignBrowser";

vi.mock("@/cloud/AuthProvider", () => {
  const session = {};
  return { useAuth: () => ({ enabled: true, session }) };
});
vi.mock("@/cloud/queries", () => ({
  getCloudProjection: vi.fn(),
  listPersonalWorkspaceDesigns: vi.fn(),
}));

const cloudDesign = { id: "cloud-1", name: "Cloud board", revision: 4 };
const localDesign = {
  id: "local-1",
  name: "Cloud board",
  revision: 0,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};
const basePart = {
  id: "part-1",
  componentId: "component-1",
  reference: "U1",
  value: "Chip",
  positionNm: { x: 0, y: 0 },
  rotationDeg: 0 as const,
  mirrored: false,
};
const onNotify = vi.fn();
const api = {
  createDesign: vi.fn(async () => localDesign),
  linkDesignToCloud: vi.fn(async () => undefined),
  dispatchLocalOnly: vi.fn(async () => ({
    ok: true as const,
    revision: 1,
    createdEntityId: null,
  })),
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(listPersonalWorkspaceDesigns).mockResolvedValue([cloudDesign]);
  vi.mocked(getCloudProjection).mockReset();
  api.createDesign.mockClear();
  api.linkDesignToCloud.mockClear();
  api.dispatchLocalOnly.mockClear();
  onNotify.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function runImport(projection: CloudProjection): Promise<void> {
  vi.mocked(getCloudProjection).mockResolvedValue({
    projection,
    revision: cloudDesign.revision,
    name: cloudDesign.name,
  });
  await act(async () =>
    root.render(
      <CloudDesignBrowser
        open
        onClose={vi.fn()}
        api={api}
        onNotify={onNotify}
      />,
    ),
  );
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Preview")
      ?.click();
  });
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Import copy")
      ?.click();
  });
}

function runtimeProjection(part: unknown): CloudProjection {
  return {
    parts: [part as (typeof basePart)],
    wires: [],
    labels: [],
  };
}

test.each(["no_connect", "power_source", "future_supply_mode"])(
  "refuses import with %s pin intent before creating or linking local design",
  async (intent) => {
    await runImport(
      runtimeProjection({ ...basePart, pins: [{ electricalIntent: intent }] }),
    );
    expect(api.createDesign).not.toHaveBeenCalled();
    expect(api.linkDesignToCloud).not.toHaveBeenCalled();
    expect(api.dispatchLocalOnly).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "Cloud import cannot preserve pin electrical intent yet. No local design was created.",
    );
  },
);

test("refuses malformed present pins data with a clear error", async () => {
  await runImport(runtimeProjection({ ...basePart, pins: { electricalIntent: null } }));
  expect(api.createDesign).not.toHaveBeenCalled();
  expect(api.linkDesignToCloud).not.toHaveBeenCalled();
  expect(api.dispatchLocalOnly).not.toHaveBeenCalled();
  expect(host.textContent).toContain(
    "Cloud import cannot inspect malformed pin data. No local design was created.",
  );
});

test.each([
  ["absent", { ...basePart }],
  ["null intent", { ...basePart, pins: [{ electricalIntent: null }] }],
])("imports legacy part with %s intent", async (_label, part) => {
  await runImport(runtimeProjection(part));
  expect(api.createDesign).toHaveBeenCalledWith(cloudDesign.name);
  expect(api.linkDesignToCloud).not.toHaveBeenCalled();
  expect(api.dispatchLocalOnly).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain("No local design was created");
  expect(onNotify).toHaveBeenCalledWith(expect.stringContaining("Imported unlinked copy of"), "success");
});

test.each([
  { nets: [{ id: "net:abcdefghij:1" }] },
  { nets: [{ id: "net:" }] },
  { nets: [{ id: "pending:bad" }] },
  { nets: [{ id: "nc:" }] },
  { netIdentity: {} },
  { netIdentityState: null },
  { net_identity_retired: [] },
  { traces: [{ netId: "net:broken" }] },
  { vias: [{ netId: "pending:2" }] },
  { freePads: [{ netId: "nc:pin" }] },
  { zones: [{ netId: "net:" }] },
  { pcb: { traces: [{ netId: "net:broken" }] } },
  { pcb: { board: { perNetClassAssignments: { "net:broken": "default" } } } },
  { boardSettings: { diffPairs: [{ pNetId: "net:broken", nNetId: null }] } },
  { board: { lengthMatchGroups: [{ netIds: ["nc:pin"] }] } },
  { board: { drcRules: [{ scopes: [{ netId: "pending:2" }] }] } },
  { netNames: { "net:broken": "SIG" } },
  { padNets: { pin: "nc:pin" } },
])("refuses declared identity before any local write: %j", async (identity) => {
  await runImport({ ...runtimeProjection(basePart), ...identity });
  expect(api.createDesign).not.toHaveBeenCalled();
  expect(api.linkDesignToCloud).not.toHaveBeenCalled();
  expect(api.dispatchLocalOnly).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Cloud import cannot preserve durable net identity yet. No local design was created.");
});

test("namespace words in authored text do not block a legacy unlinked copy", async () => {
  await runImport({ parts: [], wires: [], labels: [
    { id: "label", text: "net: pending: nc:", positionNm: { x: 0, y: 0 } },
  ] });
  expect(api.createDesign).toHaveBeenCalledTimes(1);
  expect(api.linkDesignToCloud).not.toHaveBeenCalled();
  expect(api.dispatchLocalOnly).toHaveBeenCalledTimes(1);
});

test("pin intent keeps priority when identity metadata also exists", async () => {
  await runImport({ ...runtimeProjection({ ...basePart, pins: [{ electricalIntent: "no_connect" }] }), netIdentity: {} } as CloudProjection);
  expect(api.createDesign).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Cloud import cannot preserve pin electrical intent yet.");
});
