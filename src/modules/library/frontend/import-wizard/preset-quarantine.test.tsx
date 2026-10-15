// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  ALL_FAMILIES,
  generateFootprint,
} from "../../../../shared/rendering/ipc7351b";
import { generatorUnavailableReason } from "../../shared/generator-policy";
import { installedIpcQualification } from "../../shared/generator-qualification";
import { IpcPresetTab } from "../footprint-generator/IpcPresetTab";
import { useImportWizardStore, hasCurrentPreset } from "./useImportWizardStore";
import { ImportWizardPage } from "./ImportWizardPage";
import {
  commitDrawnImportRequest,
  commitGeneratedImportRequest,
} from "./import-api";

// Every IPC family is quarantined on the pinned rendering-core (H15 D1). The
// positive wizard paths below mark chosen families available; the rest keep
// the real policy.
const qualification = vi.hoisted(() => ({ available: new Set<string>() }));
vi.mock("../../shared/generator-qualification", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../shared/generator-qualification")>();
  const ipcFamilyAvailability: typeof actual.ipcFamilyAvailability = (
    family,
    ...rest
  ) =>
    qualification.available.has(family)
      ? { available: true, revision: 2 }
      : actual.ipcFamilyAvailability(family, ...rest);
  return { ...actual, ipcFamilyAvailability };
});

vi.mock("./steps/SymbolStep", () => ({ SymbolStep: () => null }));
vi.mock("./steps/FootprintStep", () => ({ FootprintStep: () => null }));
vi.mock("./steps/ModelStep", () => ({ ModelStep: () => null }));
vi.mock("./steps/MetadataStep", () => ({ MetadataStep: () => null }));
vi.mock("./editor", () => ({
  useSymbolEditorStore: {
    getState: () => ({
      toSymbolRenderSource: () => ({ name: "Drawn C", pins: [] }),
      referencePrefix: "C",
      reset: vi.fn(),
    }),
  },
}));
vi.mock("./footprint-editor", () => ({
  useFootprintEditorStore: { getState: () => ({ reset: vi.fn() }) },
}));
vi.mock("../three-d/model-conversion", () => ({
  convertPendingModelConversion: vi.fn(),
  uploadFootprintStepModel: vi.fn(),
  validateStepUploadFile: () => null,
}));
vi.mock("./import-api", () => ({
  commitDrawnImportRequest: vi.fn(async () => ({
    componentId: "result",
    componentName: "C",
    reused: true,
  })),
  commitGeneratedImportRequest: vi.fn(async () => ({
    componentId: "result",
    componentName: "C",
    reused: true,
  })),
  commitKicadImportRequest: vi.fn(),
  inspectKicadImport: vi.fn(async () => ({
    symbols: [{ id: "symbol", name: "C", description: "" }],
    footprints: [],
  })),
}));

let root: Root;
let host: HTMLDivElement;

function generateCurrent(): void {
  const state = useImportWizardStore.getState();
  const family = state.presetFamily!;
  const size = state.presetSize!;
  state.setGeneratedFootprint({
    ...generateFootprint(family, size, state.presetDensity),
    generator: {
      kind: "ipc7351b",
      family,
      size,
      density: state.presetDensity,
    },
  });
}

function nextButton(): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((button) =>
    ["Next", "Import component"].includes(button.textContent ?? ""),
  );
  if (!button) throw new Error("Wizard action button missing");
  return button;
}

async function renderWizard(): Promise<void> {
  await act(async () =>
    root.render(
      <ImportWizardPage
        backendURL="http://test"
        moduleId="library"
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  qualification.available = new Set(["chip"]);
  useImportWizardStore.getState().reset();
  useImportWizardStore.setState({
    symbolSource: "draw",
    footprintSource: "preset",
    currentStep: 1,
    componentName: "C",
  });
  const state = useImportWizardStore.getState();
  state.setPresetFamily("chip");
  state.setPresetSize("0603");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useImportWizardStore.getState().reset();
});

for (const parameter of ["size", "density"] as const) {
  test(`${parameter} change clears the stored footprint immediately and cannot accept the previous result`, () => {
    generateCurrent();
    const previous = useImportWizardStore.getState().generatedFootprint!;
    const state = useImportWizardStore.getState();
    if (parameter === "size") state.setPresetSize("0402");
    else state.setPresetDensity("least");
    expect(useImportWizardStore.getState().generatedFootprint).toBeNull();
    state.setGeneratedFootprint(previous);
    expect(useImportWizardStore.getState().generatedFootprint).toBeNull();
    expect(hasCurrentPreset(useImportWizardStore.getState())).toBe(false);
  });

  test(`${parameter} change disables Next and final import until regeneration`, async () => {
    generateCurrent();
    await renderWizard();
    expect(nextButton().disabled).toBe(false);
    await act(async () => {
      const state = useImportWizardStore.getState();
      if (parameter === "size") state.setPresetSize("0402");
      else state.setPresetDensity("least");
    });
    expect(nextButton().disabled).toBe(true);
    await act(async () => useImportWizardStore.getState().goToStep(3));
    expect(nextButton().disabled).toBe(true);
    await act(async () => nextButton().click());
    expect(commitDrawnImportRequest).not.toHaveBeenCalled();
    expect(commitGeneratedImportRequest).not.toHaveBeenCalled();
    await act(async () => generateCurrent());
    expect(nextButton().disabled).toBe(false);
  });
}

test("preset mode with no generated footprint cannot advance or import a placeholder", async () => {
  await renderWizard();
  expect(nextButton().disabled).toBe(true);
  await act(async () => useImportWizardStore.getState().goToStep(3));
  expect(nextButton().disabled).toBe(true);
  await act(async () => nextButton().click());
  expect(commitDrawnImportRequest).not.toHaveBeenCalled();
});

test("unsafe generator output cannot be injected into current wizard state", () => {
  const state = useImportWizardStore.getState();
  state.setPresetFamily("sot");
  state.setPresetSize("SOT-23");
  generateCurrent();
  expect(useImportWizardStore.getState().generatedFootprint).toBeNull();
});

async function renderPicker(): Promise<HTMLButtonElement[]> {
  await act(async () =>
    root.render(
      <IpcPresetTab
        selection={{ family: null, size: null, density: "nominal" }}
        onFamilyChange={vi.fn()}
        onSizeChange={vi.fn()}
        onDensityChange={vi.fn()}
        onGenerate={vi.fn()}
      />,
    ),
  );
  return [...host.querySelectorAll("button")];
}

function familyButton(
  buttons: readonly HTMLButtonElement[],
  label: string,
): HTMLButtonElement {
  const button = buttons.find((candidate) =>
    candidate.textContent?.startsWith(label),
  );
  if (!button) throw new Error(`${label} family button missing`);
  return button;
}

test.runIf(installedIpcQualification() === null)(
  "picker disables all five IPC families with visible reasons on the pinned generator",
  async () => {
    qualification.available = new Set();
    const buttons = await renderPicker();
    for (const family of ["Chip", "SOT", "SOIC", "QFP", "QFN"]) {
      const button = familyButton(buttons, family);
      expect(button.disabled).toBe(true);
      expect(button.title).toContain("unavailable");
      expect(button.textContent).toContain(
        "Import a verified footprint or draw one",
      );
    }
  },
);

test("picker offers exactly the families the qualification policy makes available", async () => {
  const buttons = await renderPicker();
  expect(familyButton(buttons, "Chip").disabled).toBe(false);
  for (const family of ALL_FAMILIES) {
    const reason = generatorUnavailableReason(family.id);
    const button = familyButton(buttons, family.label);
    expect(button.disabled).toBe(reason !== null);
    expect(button.title).toBe(reason ?? "");
  }
});

for (const symbolSource of ["draw", "import"] as const) {
  test(`${symbolSource} symbol submits the exact displayed generator tuple and preview`, async () => {
    useImportWizardStore.setState({ symbolSource, currentStep: 3 });
    if (symbolSource === "import") {
      useImportWizardStore
        .getState()
        .setSymbolFile(new File(["fixture"], "C.kicad_sym"));
    }
    generateCurrent();
    const displayed = useImportWizardStore.getState().generatedFootprint!;
    await renderWizard();
    expect(nextButton().disabled).toBe(false);
    await act(async () => nextButton().click());
    const submit = vi.mocked(
      symbolSource === "draw"
        ? commitDrawnImportRequest
        : commitGeneratedImportRequest,
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0][2].generatedFootprint).toEqual({
      generator: displayed.generator,
      source: displayed.source,
      metadata: displayed.metadata,
    });
  });
}
