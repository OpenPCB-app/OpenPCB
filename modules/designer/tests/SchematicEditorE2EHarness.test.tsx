import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/pcb/palette/ComponentPalette", () => ({
  ComponentPalette: () => <div data-testid="component-palette">Palette</div>,
}));

vi.mock("@/components/pcb/properties/FloatingPropertiesPopover", () => ({
  FloatingPropertiesPopover: () => (
    <div data-testid="floating-properties-popover" />
  ),
}));

vi.mock("@/lib/render-engine/adapters/SchematicCanvasR3F", () => ({
  SchematicCanvasR3F: () => {
    return (
      <div data-testid="schematic-canvas">
        <canvas
          ref={(node) => {
            if (!node) return;
            (
              node as HTMLCanvasElement & {
                __r3f?: {
                  root?: {
                    getState?: () => {
                      camera: {
                        position: { x: number; y: number };
                        zoom: number;
                      };
                      size: { width: number; height: number };
                    };
                  };
                };
              }
            ).__r3f = {
              root: {
                getState: () => ({
                  camera: { position: { x: 0, y: 0 }, zoom: 50 },
                  size: { width: 800, height: 600 },
                }),
              },
            };
          }}
        />
      </div>
    );
  },
}));

import { SchematicEditorE2EHarness } from "./SchematicEditorE2EHarness";

describe("SchematicEditorE2EHarness", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/?e2e=schematic");
  });

  afterEach(() => {
    cleanup();
    delete window.__SCHEMATIC_E2E_PERF__;
  });

  it("initializes the schematic harness and base fixture", async () => {
    render(<SchematicEditorE2EHarness />);

    await expect(screen.findByText("Schematic E2E")).resolves.toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("e2e-symbols")).toHaveTextContent("2");
      expect(screen.getByTestId("e2e-wires")).toHaveTextContent("0");
    });
    expect(screen.getByTestId("schematic-canvas")).toBeInTheDocument();
    expect(window.__SCHEMATIC_E2E_PERF__).toBeDefined();
  });

  it("loads the drag-wiring fixture from the URL", async () => {
    window.history.pushState({}, "", "/?e2e=schematic&fixture=drag-wiring");
    render(<SchematicEditorE2EHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("e2e-symbols")).toHaveTextContent("3");
      expect(screen.getByTestId("e2e-wires")).toHaveTextContent("2");
    });
  });

  it("exposes viewport-derived camera inspection values", async () => {
    render(<SchematicEditorE2EHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("e2e-pin2")).toHaveTextContent("464,300");
      expect(screen.getByTestId("e2e-symbol1")).toHaveTextContent("432,300");
      expect(screen.getByTestId("e2e-first-symbol")).toHaveTextContent(
        "400,300",
      );
    });
  });
});
