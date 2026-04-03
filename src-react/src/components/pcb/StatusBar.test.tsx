import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePcbStore } from "@/stores/pcb-store";
import { useSchematicStore } from "@/stores/schematic-store";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  beforeEach(() => {
    useSchematicStore.setState((state) => ({
      ...state,
      chrome: {
        ...state.chrome,
        viewport: { offsetX: 0, offsetY: 0, zoom: 2 },
        gridSize: 1_270_000,
        selectedEntityIds: new Set(["symbol-1"]),
        activeTool: "select",
      },
      session: null,
    }));

    usePcbStore.setState({
      viewport: { offsetX: 0, offsetY: 0, zoom: 5 },
      gridSize: 0.5,
      selectedIds: new Set(),
      activeTool: "select",
      routingSession: null,
    });
  });

  it("shows schematic selection on the schematic tab", () => {
    render(<StatusBar designTab="schematic" />);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByText("Grid: 1.27mm")).toBeInTheDocument();
  });

  it("ignores schematic selection on the pcb tab", () => {
    render(<StatusBar designTab="pcb" />);

    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
    expect(screen.getByText("Grid: 0.50mm")).toBeInTheDocument();
    expect(screen.getByText("Zoom: 500%")).toBeInTheDocument();
  });
});
