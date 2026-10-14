// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { PcbExportDialog } from "./PcbExportDialog";

const props = {
  backendURL: "http://127.0.0.1:0",
  moduleId: "designer",
  designId: "d1",
  open: true,
  onClose: () => undefined,
};

async function renderDialog(): Promise<string> {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<PcbExportDialog {...props} />));
  const text = document.body.textContent ?? "";
  await act(async () => root.unmount());
  host.remove();
  return text;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("designer.outputQuarantine on: unavailable stub", async () => {
  vi.stubEnv("VITE_FEATURE_DESIGNER_OUTPUTQUARANTINE", "1");
  expect(await renderDialog()).toContain("Manufacturing exports unavailable");
});

test("designer.outputQuarantine off: full export dialog", async () => {
  vi.stubEnv("VITE_FEATURE_DESIGNER_OUTPUTQUARANTINE", "0");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("offline"))),
  );
  const text = await renderDialog();
  expect(text).toContain("Export manufacturing files");
  expect(text).not.toContain("Manufacturing exports unavailable");
});
