import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePcbStore } from "@/stores/pcb-store";

vi.mock("@/components/pcb-editor/PcbSidebar", () => ({
  PcbSidebar: () => <div data-testid="pcb-sidebar">Sidebar</div>,
}));

vi.mock("@/components/pcb-editor/PcbToolbar", () => ({
  PcbToolbar: () => <div data-testid="pcb-toolbar">Toolbar</div>,
}));

vi.mock("@/lib/render-engine/adapters/PcbCanvasR3F", () => ({
  PcbCanvasR3F: () => {
    const document = usePcbStore((state) => state.document);
    return (
      <div data-testid="pcb-canvas">
        <span data-testid="pcb-placement-count">
          {document?.placements.length ?? 0}
        </span>
      </div>
    );
  },
}));

import { PcbEditorE2EHarness } from "./PcbEditorE2EHarness";

describe("PcbEditorE2EHarness", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/?e2e=pcb");
  });

  afterEach(() => {
    cleanup();
  });

  it("initializes the PCB harness and loads the test document", async () => {
    render(<PcbEditorE2EHarness />);

    await expect(screen.findByText("PCB E2E")).resolves.toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("e2e-traces")).toHaveTextContent("0");
      expect(screen.getByTestId("e2e-vias")).toHaveTextContent("0");
      expect(screen.getByTestId("e2e-tool")).toHaveTextContent("select");
    });

    expect(usePcbStore.getState().document?.placements.length).toBe(2);
  });

  it("renders the PCB placements through the canvas wrapper", async () => {
    render(<PcbEditorE2EHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("pcb-canvas")).toBeInTheDocument();
      expect(screen.getByTestId("pcb-placement-count")).toHaveTextContent("2");
    });
  });

  it("exposes viewport state in the debug panel", async () => {
    render(<PcbEditorE2EHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("e2e-offset-x")).toHaveTextContent("0.00");
      expect(screen.getByTestId("e2e-offset-y")).toHaveTextContent("0.00");
      expect(screen.getByTestId("e2e-zoom")).toHaveTextContent("1.0000");
    });
  });
});
