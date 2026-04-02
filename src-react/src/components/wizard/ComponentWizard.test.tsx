import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ComponentWizard } from "./ComponentWizard";
import { useComponentWizardStore } from "@/stores/component-wizard-store";
import { useSymbolEditorStore } from "@/components/symbol-editor";
import { useFootprintEditorStore } from "@/components/footprint-editor";

const {
  toast,
  createWorkspaceComponentRecord,
  patchWorkspaceComponentRecord,
  publishWorkspaceComponentRecord,
  parseKicadSymbolImport,
  parseKicadFootprintImport,
  uploadFile,
} = vi.hoisted(() => ({
  toast: vi.fn(),
  createWorkspaceComponentRecord: vi.fn(),
  patchWorkspaceComponentRecord: vi.fn(),
  publishWorkspaceComponentRecord: vi.fn(),
  parseKicadSymbolImport: vi.fn(),
  parseKicadFootprintImport: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@/components/ui/use-toast", () => ({ toast }));

vi.mock("@/stores/app-store", () => ({
  useAppStore: (selector: (state: { activeWorkspaceId: string | null }) => unknown) =>
    selector({ activeWorkspaceId: "workspace-1" }),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />, 
}));

vi.mock("@/lib/api/component-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/component-api")>("@/lib/api/component-api");
  return {
    ...actual,
    createWorkspaceComponentRecord,
    patchWorkspaceComponentRecord,
    publishWorkspaceComponentRecord,
    parseKicadSymbolImport,
    parseKicadFootprintImport,
  };
});

vi.mock("@shared/sdk/file-client", () => ({ uploadFile }));

function createMockContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    rect: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineJoin: "round",
    lineCap: "round",
    globalAlpha: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

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
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (((contextId: string) =>
        contextId === "2d" ? createMockContext() : null) as unknown) as HTMLCanvasElement["getContext"],
    );
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

    createWorkspaceComponentRecord.mockResolvedValue({
      id: "draft-1",
      componentId: null,
      wizardStep: 0,
      payload: {},
      warnings: [],
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    });
    patchWorkspaceComponentRecord.mockResolvedValue({ id: "draft-1" });
    publishWorkspaceComponentRecord.mockResolvedValue({
      componentId: "component-1",
      revision: { id: "rev-1" },
    });
    uploadFile.mockResolvedValue({ id: "file-1", originalName: "Package.step" });

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
        properties: { Value: "chip", Reference: "U", Description: "Imported symbol" },
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
          { type: "line", layer: "F.Fab", data: { start: [-1, -0.5], end: [1, -0.5], width: 0.12 } },
          { type: "line", layer: "F.Fab", data: { start: [-1, 0.5], end: [1, 0.5], width: 0.12 } },
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

  it("imports symbol and footprint, preserves drafts across navigation, and publishes imported payload", async () => {
    const onClose = vi.fn();
    const onPublished = vi.fn();
    const { container } = render(<ComponentWizard onClose={onClose} onPublished={onPublished} />);

    await screen.findByText(/Step 1 of 4: Symbol/i);

    const symbolInput = container.querySelector('input[accept=".kicad_sym"]') as HTMLInputElement;
    fireEvent.change(symbolInput, {
      target: { files: [new File(["symbol"], "chip.kicad_sym", { type: "text/plain" })] },
    });

    await waitFor(() => {
      expect(useSymbolEditorStore.getState().draft.pins).toHaveLength(2);
      expect(useComponentWizardStore.getState().draft?.symbolData?.metadata.name).toBe("chip");
    });
    expect(screen.getByTestId("symbol-editor-canvas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 2 of 4: Footprint/i);

    const footprintInput = container.querySelector('input[accept=".kicad_mod"]') as HTMLInputElement;
    fireEvent.change(footprintInput, {
      target: { files: [new File(["footprint"], "chip.kicad_mod", { type: "text/plain" })] },
    });

    await waitFor(() => {
      expect(useFootprintEditorStore.getState().draft.pads).toHaveLength(2);
      expect(useComponentWizardStore.getState().draft?.footprintData?.metadata.name).toBe("chip");
    });

    const chipPresetButton = screen.getByRole("button", { name: /Chip R, C, L/i });
    expect(chipPresetButton).toBeDisabled();
    expect(screen.getByRole("button", { name: /Replace imported footprint/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText(/Step 1 of 4: Symbol/i);
    expect(useComponentWizardStore.getState().draft?.symbolData?.pins).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 2 of 4: Footprint/i);
    expect(useComponentWizardStore.getState().draft?.footprintData?.pads).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 3 of 4: 3D Model/i);

    const modelInput = container.querySelector('input[accept=".step,.stp,.wrl"]') as HTMLInputElement;
    fireEvent.change(modelInput, {
      target: { files: [new File(["3d"], "Package.step", { type: "application/octet-stream" })] },
    });

    await waitFor(() => {
      expect(useComponentWizardStore.getState().draft?.modelData?.stepFileName).toBe("Package.step");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Step 4 of 4: Specs/i);
    fireEvent.click(screen.getByRole("button", { name: /Save Component/i }));

    await waitFor(() => {
      expect(publishWorkspaceComponentRecord).toHaveBeenCalledWith("draft-1");
    });

    const finalPatchPayload = patchWorkspaceComponentRecord.mock.calls.at(-1)?.[1]?.payload;
    expect(finalPatchPayload.symbolData.rawKicadSource).toContain("symbol chip");
    expect(finalPatchPayload.variants[0]?.footprintOptions[0]?.kicadPayload.rawKicadSource).toContain(
      "footprint chip",
    );
    expect(
      finalPatchPayload.variants[0]?.footprintOptions[0]?.model3dOptions[0]?.fileName,
    ).toBe("Package.step");
    expect(onPublished).toHaveBeenCalledWith("component-1");
    expect(onClose).toHaveBeenCalled();
  });
});
