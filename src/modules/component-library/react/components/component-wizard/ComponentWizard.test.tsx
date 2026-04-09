import { readFileSync } from "fs";
import { dirname, join } from "path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { fileURLToPath } from "url";
import { ComponentWizard } from "./ComponentWizard";
import { useComponentWizardStore } from "@/stores/component-wizard-store";
import { useSymbolEditorStore } from "@/components/symbol-editor";
import { useFootprintEditorStore } from "@/components/footprint-editor";
import {
  IMPORTED_SYMBOL_NORMALIZATION_PROPERTY,
  IMPORTED_SYMBOL_NORMALIZATION_VERSION,
} from "@/components/symbol-editor/import-normalization";
import { ThemeProvider } from "@/components/ThemeProvider";
import { parseKicadSymbolLib } from "../../../../src-ts/src/infrastructure/parsers/kicad/kicad-symbol-parser";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../src-ts/src/infrastructure/parsers/kicad/__fixtures__",
);

function loadParsedSymbolFixture(name: string) {
  return parseKicadSymbolLib(readFileSync(join(FIXTURES_DIR, name), "utf-8"))
    .symbols[0]!;
}

const {
  toast,
  createComponent,
  patchWorkspaceComponentRecord,
  parseKicadSymbolImport,
  parseKicadFootprintImport,
  uploadFile,
} = vi.hoisted(() => ({
  toast: vi.fn(),
  createComponent: vi.fn(),
  patchWorkspaceComponentRecord: vi.fn(),
  parseKicadSymbolImport: vi.fn(),
  parseKicadFootprintImport: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@/components/ui/use-toast", () => ({ toast }));

vi.mock("@/stores/app-store", () => ({
  useAppStore: (
    selector: (state: { activeWorkspaceId: string | null }) => unknown,
  ) => selector({ activeWorkspaceId: "workspace-1" }),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => <div />,
}));

vi.mock("@/lib/api/component-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/component-api")
  >("@/lib/api/component-api");
  return {
    ...actual,
    createComponent,
    patchWorkspaceComponentRecord,
    parseKicadSymbolImport,
    parseKicadFootprintImport,
  };
});

vi.mock("@shared/sdk/file-client", () => ({ uploadFile }));

vi.mock("@/lib/render-engine/interaction/EdaCanvas", () => ({
  EdaCanvas: ({
    children,
    testId,
  }: {
    children: ReactNode;
    testId?: string;
  }) => <div data-testid={testId ?? "eda-canvas"}>{children}</div>,
}));

vi.mock("@/lib/render-engine/primitives/GridShader", () => ({
  GridShader: () => <div data-testid="grid-shader" />,
}));

vi.mock("@/lib/render-engine/primitives/SymbolBody", () => ({
  SymbolBody: () => <div data-testid="symbol-body" />,
}));

vi.mock("@/lib/render-engine/primitives/PinDots", () => ({
  PinDots: () => <div data-testid="pin-dots" />,
}));

vi.mock("@/lib/render-engine/primitives/PadInstances", () => ({
  PadInstances: () => <div data-testid="pad-instances" />,
}));

vi.mock("@/lib/render-engine/primitives/EDAText", () => ({
  EDAText: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("ComponentWizard", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 1000,
          bottom: 700,
          width: 1000,
          height: 700,
          toJSON: () => ({}),
        }) as DOMRect,
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useComponentWizardStore.getState().reset();
    useSymbolEditorStore.getState().resetDraft("symbol-test");
    useFootprintEditorStore.getState().resetDraft("footprint-test");

    createComponent.mockResolvedValue({
      id: "component-1",
      displayLabel: "chip",
      canonicalKey: "chip-1",
      description: "Imported symbol",
      scope: "workspace",
      categoryPath: null,
      tags: [],
      symbolData: null,
      variants: [],
      defaultVariantId: null,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    });
    patchWorkspaceComponentRecord.mockResolvedValue({ id: "draft-1" });
    uploadFile.mockResolvedValue({
      id: "file-1",
      originalName: "Package.step",
    });

    parseKicadSymbolImport.mockResolvedValue({
      fileName: "chip.kicad_sym",
      availableSymbols: ["chip"],
      symbol: {
        name: "chip",
        kicadId: null,
        pins: [
          {
            name: "IN",
            number: "1",
            electricalType: "input",
            direction: "line",
            position: { x: -7.62, y: 0 },
            length: 2.54,
            rotation: 0,
            unit: 1,
            hidden: false,
          },
          {
            name: "OUT",
            number: "2",
            electricalType: "output",
            direction: "line",
            position: { x: 7.62, y: 0 },
            length: 2.54,
            rotation: 180,
            unit: 1,
            hidden: false,
          },
        ],
        units: 1,
        properties: {
          Value: "chip",
          Reference: "U",
          Description: "Imported symbol",
        },
        bodyGraphics: [
          {
            unit: 1,
            node: [
              "rectangle",
              ["start", -5.08, -3.81],
              ["end", 5.08, 3.81],
              ["stroke", ["width", 0.254]],
              ["fill", ["type", "none"]],
            ],
          },
        ],
        warnings: [],
        rawSource: "(symbol chip ...)",
      },
    });

    parseKicadFootprintImport.mockResolvedValue({
      fileName: "chip.kicad_mod",
      footprint: {
        name: "chip",
        description: "Imported footprint",
        tags: ["chip"],
        pads: [
          {
            number: "1",
            type: "smd",
            shape: "rect",
            position: { x: -0.5, y: 0 },
            size: { width: 0.6, height: 0.8 },
            rotation: 0,
            layers: ["F.Cu", "F.Mask", "F.Paste"],
          },
          {
            number: "2",
            type: "smd",
            shape: "rect",
            position: { x: 0.5, y: 0 },
            size: { width: 0.6, height: 0.8 },
            rotation: 0,
            layers: ["F.Cu", "F.Mask", "F.Paste"],
          },
        ],
        graphics: [
          {
            type: "line",
            layer: "F.Fab",
            data: { start: [-1, -0.5], end: [1, -0.5], width: 0.12 },
          },
          {
            type: "line",
            layer: "F.Fab",
            data: { start: [-1, 0.5], end: [1, 0.5], width: 0.12 },
          },
        ],
        model3dRefs: [
          {
            path: "${KICAD8_3DMODEL_DIR}/chip.step",
            resolvedFileName: "Package.step",
            offset: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: { x: 0, y: 0, z: 0 },
          },
        ],
        attributes: { type: "smd" },
        warnings: [],
        rawSource: "(footprint chip ...)",
      },
    });
  });

  function renderWizard(ui: ReactElement) {
    return render(<ThemeProvider>{ui}</ThemeProvider>);
  }

  it("imports symbol and footprint, preserves drafts across navigation, and publishes imported payload", async () => {
    const onClose = vi.fn();
    const onPublished = vi.fn();
    const { container } = renderWizard(
      <ComponentWizard onClose={onClose} onPublished={onPublished} />,
    );

    await screen.findByText(/Step 1 of 4: Symbol/i);

    const symbolInput = container.querySelector(
      'input[accept=".kicad_sym"]',
    ) as HTMLInputElement;
    fireEvent.change(symbolInput, {
      target: {
        files: [new File(["symbol"], "chip.kicad_sym", { type: "text/plain" })],
      },
    });

    await waitFor(() => {
      expect(useSymbolEditorStore.getState().draft.pins).toHaveLength(2);
      expect(
        useComponentWizardStore.getState().draft?.symbolData?.metadata.name,
      ).toBe("chip");
    });
    expect(screen.getByTestId("symbol-editor-canvas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 2 of 4: Footprint/i);

    const footprintInput = container.querySelector(
      'input[accept=".kicad_mod"]',
    ) as HTMLInputElement;
    fireEvent.change(footprintInput, {
      target: {
        files: [
          new File(["footprint"], "chip.kicad_mod", { type: "text/plain" }),
        ],
      },
    });

    await waitFor(() => {
      expect(useFootprintEditorStore.getState().draft.pads).toHaveLength(2);
      expect(
        useComponentWizardStore.getState().draft?.footprintData?.metadata.name,
      ).toBe("chip");
    });

    const chipPresetButton = screen.getByRole("button", {
      name: /Chip R, C, L/i,
    });
    expect(chipPresetButton).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Replace imported footprint/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText(/Step 1 of 4: Symbol/i);
    expect(
      useComponentWizardStore.getState().draft?.symbolData?.pins,
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 2 of 4: Footprint/i);
    expect(
      useComponentWizardStore.getState().draft?.footprintData?.pads,
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 3 of 4: 3D Model/i);

    const modelInput = container.querySelector(
      'input[accept=".step,.stp,.wrl"]',
    ) as HTMLInputElement;
    fireEvent.change(modelInput, {
      target: {
        files: [
          new File(["3d"], "Package.step", {
            type: "application/octet-stream",
          }),
        ],
      },
    });

    await waitFor(() => {
      expect(
        useComponentWizardStore.getState().draft?.modelData?.stepFileName,
      ).toBe("Package.step");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 4 of 4: Specs/i);
    fireEvent.click(screen.getByRole("button", { name: /Save Component/i }));

    await waitFor(() => {
      expect(createComponent).toHaveBeenCalledTimes(1);
    });

    const createPayload = createComponent.mock.calls.at(-1)?.[0];
    expect(createPayload.symbolData.rawKicadSource).toContain("symbol chip");
    expect(createPayload.symbolData.properties).toMatchObject({
      [IMPORTED_SYMBOL_NORMALIZATION_PROPERTY]:
        IMPORTED_SYMBOL_NORMALIZATION_VERSION,
    });
    expect(
      createPayload.variants[0]?.footprintOptions[0]?.kicadPayload
        .rawKicadSource,
    ).toContain("footprint chip");
    expect(
      createPayload.variants[0]?.footprintOptions[0]?.model3dOptions[0]
        ?.fileName,
    ).toBe("Package.step");
    expect(onPublished).toHaveBeenCalledWith("component-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("warns for unsupported mixed multi-unit KiCad symbols but still lets the wizard publish", async () => {
    const onClose = vi.fn();
    const onPublished = vi.fn();
    parseKicadSymbolImport.mockResolvedValueOnce({
      fileName: "mixed_multi_unit_ic.kicad_sym",
      availableSymbols: ["MIXEDMULTI"],
      symbol: loadParsedSymbolFixture("mixed_multi_unit_ic.kicad_sym"),
    });

    const { container } = renderWizard(
      <ComponentWizard onClose={onClose} onPublished={onPublished} />,
    );

    await screen.findByText(/Step 1 of 4: Symbol/i);

    const symbolInput = container.querySelector(
      'input[accept=".kicad_sym"]',
    ) as HTMLInputElement;
    fireEvent.change(symbolInput, {
      target: {
        files: [
          new File(["symbol"], "mixed_multi_unit_ic.kicad_sym", {
            type: "text/plain",
          }),
        ],
      },
    });

    await waitFor(() => {
      const symbolData = useComponentWizardStore.getState().draft?.symbolData;
      expect(symbolData?.metadata.name).toBe("MIXEDMULTI");
      expect(symbolData?.importPreservation?.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "multi_unit_combined" }),
          expect.objectContaining({
            code: "import_normalization_skipped",
            message: expect.stringContaining("unsupported unit 2"),
          }),
        ]),
      );
      expect(new Set(symbolData?.pins.map((pin) => pin.length))).toEqual(
        new Set([5_080_000]),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 2 of 4: Footprint/i);

    const footprintInput = container.querySelector(
      'input[accept=".kicad_mod"]',
    ) as HTMLInputElement;
    fireEvent.change(footprintInput, {
      target: {
        files: [
          new File(["footprint"], "chip.kicad_mod", { type: "text/plain" }),
        ],
      },
    });

    await waitFor(() => {
      expect(useFootprintEditorStore.getState().draft.pads).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 3 of 4: 3D Model/i);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 4 of 4: Specs/i);
    fireEvent.click(screen.getByRole("button", { name: /Save Component/i }));

    await waitFor(() => {
      expect(createComponent).toHaveBeenCalledTimes(1);
    });
    expect(
      createComponent.mock.calls.at(-1)?.[0].symbolData.properties,
    ).toMatchObject({
      [IMPORTED_SYMBOL_NORMALIZATION_PROPERTY]:
        IMPORTED_SYMBOL_NORMALIZATION_VERSION,
    });
    expect(onPublished).toHaveBeenCalledWith("component-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps new-component drafts local until publish and does not persist on close", async () => {
    const onClose = vi.fn();
    renderWizard(<ComponentWizard onClose={onClose} />);

    await screen.findByText(/Step 1 of 4: Symbol/i);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 2 of 4: Footprint/i);

    expect(createComponent).not.toHaveBeenCalled();
    expect(patchWorkspaceComponentRecord).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button")[0]!);

    expect(createComponent).not.toHaveBeenCalled();
    expect(patchWorkspaceComponentRecord).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
