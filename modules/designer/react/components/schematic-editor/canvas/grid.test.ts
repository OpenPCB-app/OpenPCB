import { describe, expect, it } from "vitest";
import {
  getGridPixelSpacing,
  getSnappedGridBounds,
  getVisibleSchematicBounds,
  renderGrid,
} from "./grid";
import type { Viewport } from "../types";

function createContextRecorder() {
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  const verticalLines: number[] = [];
  const horizontalLines: number[] = [];
  let lastMove: { x: number; y: number } | null = null;

  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    beginPath() {},
    arc(x: number, y: number, radius: number) {
      arcs.push({ x, y, radius });
    },
    fill() {},
    moveTo(x: number, y: number) {
      lastMove = { x, y };
    },
    lineTo(x: number, y: number) {
      if (lastMove && lastMove.y === 0) {
        verticalLines.push(lastMove.x);
      } else if (lastMove && lastMove.x === 0) {
        horizontalLines.push(lastMove.y);
      }
      lastMove = { x, y };
    },
    stroke() {},
  } as unknown as CanvasRenderingContext2D;

  return { ctx, arcs, verticalLines, horizontalLines };
}

describe("grid helpers", () => {
  it("computes visible world bounds from viewport pixels", () => {
    const viewport: Viewport = { offsetX: 100, offsetY: -50, zoom: 2 };
    const bounds = getVisibleSchematicBounds(300, 250, viewport);

    expect(bounds).toEqual({
      left: -50,
      top: 25,
      right: 100,
      bottom: 150,
    });
  });

  it("snaps bounds to grid intersections", () => {
    const snapped = getSnappedGridBounds(
      { left: -50, top: 25, right: 100, bottom: 150 },
      40,
    );
    expect(snapped).toEqual({
      left: -80,
      top: 0,
      right: 120,
      bottom: 160,
    });
  });

  it("reports grid spacing in screen pixels", () => {
    expect(getGridPixelSpacing(1_270_000, { offsetX: 0, offsetY: 0, zoom: 0.5 })).toBe(
      635_000,
    );
  });

  it("renders minor and major grid geometry in screen space", () => {
    const { ctx, arcs, verticalLines, horizontalLines } = createContextRecorder();
    const viewport: Viewport = { offsetX: 10, offsetY: 20, zoom: 1 };

    renderGrid(ctx, 160, 160, viewport, 40);

    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs[0]).toMatchObject({ x: -30, y: -20 });
    expect(verticalLines).toContain(10);
    expect(horizontalLines).toContain(20);
  });

  it("throws on non-positive grid sizes", () => {
    const { ctx } = createContextRecorder();
    expect(() => renderGrid(ctx, 100, 100, { offsetX: 0, offsetY: 0, zoom: 1 }, 0)).toThrow(
      /gridSize/,
    );
  });
});
