// @vitest-environment happy-dom
import React, { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogHostStore } from "../../../../shared/frontend/ui/dialog-host-store";
import { PreviewModal } from "../components/PreviewModal";
import { ImportWizardPage } from "./ImportWizardPage";
import { useImportWizardStore } from "./useImportWizardStore";
import { useSymbolEditorStore } from "./editor/useSymbolEditorStore";
import { useFootprintEditorStore } from "./footprint-editor/useFootprintEditorStore";

vi.mock("../three-d/model-conversion", () => ({
  convertPendingModelConversion: vi.fn(),
  uploadFootprintStepModel: vi.fn(),
  validateStepUploadFile: () => null,
}));
vi.mock("./editor", async () => ({
  useSymbolEditorStore: (await import("./editor/useSymbolEditorStore"))
    .useSymbolEditorStore,
}));
vi.mock("./footprint-editor", async () => ({
  useFootprintEditorStore: (
    await import("./footprint-editor/useFootprintEditorStore")
  ).useFootprintEditorStore,
}));
vi.mock("./steps/SymbolStep", () => ({ SymbolStep: StepFixture }));
vi.mock("./steps/FootprintStep", () => ({ FootprintStep: () => null }));
vi.mock("./steps/ModelStep", () => ({ ModelStep: () => null }));
vi.mock("./steps/MetadataStep", () => ({ MetadataStep: () => null }));

function StepFixture(): ReactElement {
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <input aria-label="Name" />
      <textarea aria-label="Notes" />
      <button
        type="button"
        aria-label="Open preview"
        onClick={() => setPreview(true)}
      >
        Preview
      </button>
      {preview ? (
        <PreviewModal title="Preview" onClose={() => setPreview(false)}>
          <span>large preview</span>
        </PreviewModal>
      ) : null}
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn>;

function resetStores(): void {
  useImportWizardStore.getState().reset();
  useSymbolEditorStore.getState().reset();
  useFootprintEditorStore.getState().reset();
  for (const request of useDialogHostStore.getState().queue) {
    if (request.kind === "confirm") request.settle(false);
  }
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  resetStores();
  useImportWizardStore.getState().setSymbolSource("draw");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onClose = vi.fn();
  await act(async () =>
    root.render(
      <ImportWizardPage
        backendURL={null}
        moduleId="library"
        onClose={onClose}
        onImported={() => undefined}
      />,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStores();
});

function el<T extends HTMLElement>(label: string): T {
  const found = document.querySelector<T>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`${label} not rendered`);
  return found;
}

async function focus(target: HTMLElement | null): Promise<void> {
  await act(async () => {
    if (target) target.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  });
}

async function press(
  key: string,
  init: KeyboardEventInit & { keyCode?: number } = {},
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

const step = () => useImportWizardStore.getState().currentStep;
const confirms = () => useDialogHostStore.getState().queue;

async function settleConfirm(value: boolean): Promise<void> {
  const [request] = confirms();
  if (request?.kind !== "confirm") throw new Error("no confirm dialog queued");
  await act(async () => request.settle(value));
}

describe("ImportWizardPage Enter", () => {
  it("never advances from focused fields, buttons, IME or repeat", async () => {
    for (const label of ["Name", "Notes", "Open preview"]) {
      await focus(el(label));
      await press("Enter");
    }
    await focus(null);
    await press("Enter", { isComposing: true });
    await press("Enter", { keyCode: 229 });
    await press("Enter", { repeat: true });
    expect(step()).toBe(0);

    await press("Enter");
    expect(step()).toBe(1);
  });
});

describe("ImportWizardPage Escape", () => {
  it("closes a clean wizard, but not from a text field", async () => {
    await focus(el("Name"));
    await press("Escape");
    expect(onClose).not.toHaveBeenCalled();

    await focus(null);
    await press("Escape");
    expect(confirms()).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding drawn work and keeps it on cancel", async () => {
    useSymbolEditorStore.getState().addPin({
      name: "1",
      number: "1",
      electricalType: "passive",
      positionMm: { x: 0, y: 0 },
      lengthMm: 2.54,
      rotationDeg: 180,
    });
    await press("Escape");
    expect(confirms()).toHaveLength(1);
    // A second Escape while the confirm is pending queues no duplicate.
    await press("Escape");
    expect(confirms()).toHaveLength(1);

    await settleConfirm(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(useSymbolEditorStore.getState().pins).toHaveLength(1);

    await press("Escape");
    await settleConfirm(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useSymbolEditorStore.getState().pins).toHaveLength(0);
  });

  it("treats a drawn footprint as unsaved work", async () => {
    useFootprintEditorStore
      .getState()
      .addGraphic(
        {
          kind: "line",
          a: { x: 0, y: 0 },
          b: { x: 1, y: 0 },
          strokeWidthMm: 0.15,
        },
        "F.SilkS",
      );
    await press("Escape");
    expect(confirms()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an open preview modal takes Escape before the wizard", async () => {
    await act(async () => el("Open preview").click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await press("Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await focus(null);
    await press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter behind an open modal does not advance", async () => {
    await act(async () => el("Open preview").click());
    await focus(null);
    await press("Enter");
    expect(step()).toBe(0);
  });
});
