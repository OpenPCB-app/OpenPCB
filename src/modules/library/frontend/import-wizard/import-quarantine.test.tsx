// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { FOOTPRINT_IMPORT_UNAVAILABLE } from "../../shared/import-policy";
import { FootprintStep } from "./steps/FootprintStep";
import { useImportWizardStore } from "./useImportWizardStore";

vi.mock("../../../../shared/frontend/canvas/preview", () => ({
  FootprintPreviewCanvas: () => null,
}));
vi.mock("./footprint-editor", () => ({
  FootprintEditorCanvas: () => null,
  FootprintEditorToolbar: () => null,
  LayerPanel: () => null,
  PadPropertyPanel: () => null,
  useFootprintEditorStore: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

test("KiCad preview explains commit quarantine while file selection and other paths remain available", async () => {
  // The notice belongs to the release-only quarantine flag.
  vi.stubEnv("VITE_FEATURE_LIBRARY_FOOTPRINTINTAKEQUARANTINE", "1");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useImportWizardStore.getState().reset();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<FootprintStep />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      FOOTPRINT_IMPORT_UNAVAILABLE,
    );
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toBe(".kicad_mod");
    expect(input?.disabled).toBe(false);
    expect(host.textContent).toContain("Preview .kicad_mod");
    for (const label of ["Preset", "Draw"]) {
      const button = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === label,
      );
      expect(button?.disabled).toBe(false);
    }
    const preset = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Preset",
    )!;
    await act(async () => preset.click());
    expect(useImportWizardStore.getState().footprintSource).toBe("preset");
    expect(host.querySelector('[role="status"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    useImportWizardStore.getState().reset();
  }
});
