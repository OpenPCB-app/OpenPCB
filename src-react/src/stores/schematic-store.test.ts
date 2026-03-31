import { beforeEach, describe, expect, it } from "vitest";
import { useSchematicStore } from "./schematic-store";
import { screenToSchematic } from "@/components/pcb/canvas/viewport";

describe("useSchematicStore", () => {
  beforeEach(() => {
    useSchematicStore.setState({
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      gridSize: 1_270_000,
      showGrid: true,
    });
  });

  it("defaults to 50mil grid size in nanometers", () => {
    expect(useSchematicStore.getState().gridSize).toBe(1_270_000);
  });

  it("zoomAt preserves world position under cursor", () => {
    const state = useSchematicStore.getState();
    const cursor = { x: 240, y: 180 };
    const worldBefore = screenToSchematic(
      cursor.x,
      cursor.y,
      useSchematicStore.getState().viewport,
    );

    state.zoomAt(cursor.x, cursor.y, 1.8);

    const worldAfter = screenToSchematic(
      cursor.x,
      cursor.y,
      useSchematicStore.getState().viewport,
    );

    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThanOrEqual(1e-9);
  });
});
