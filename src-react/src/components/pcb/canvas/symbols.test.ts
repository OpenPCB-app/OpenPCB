import { describe, expect, it } from "vitest";
import type { SymbolEntity, Viewport } from "../types";
import {
  getSymbolBodyBounds,
  getWorldConnectorAnchors,
  renderSymbol,
  transformSymbolLocalPoint,
} from "./symbols";

function createContextRecorder() {
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  const operations: string[] = [];
  const transformStack: Array<{ x: number; y: number; rotation: number; scaleX: number; scaleY: number }> = [];
  let currentTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

  const ctx = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    save() {
      transformStack.push({ ...currentTransform });
    },
    restore() {
      currentTransform = transformStack.pop() ?? currentTransform;
    },
    translate(x: number, y: number) {
      currentTransform = { ...currentTransform, x: currentTransform.x + x, y: currentTransform.y + y };
    },
    rotate(rotation: number) {
      currentTransform = { ...currentTransform, rotation: currentTransform.rotation + rotation };
    },
    scale(scaleX: number, scaleY: number) {
      currentTransform = {
        ...currentTransform,
        scaleX: currentTransform.scaleX * scaleX,
        scaleY: currentTransform.scaleY * scaleY,
      };
    },
    beginPath() {
      operations.push("beginPath");
    },
    moveTo() {
      operations.push("moveTo");
    },
    lineTo() {
      operations.push("lineTo");
    },
    closePath() {
      operations.push("closePath");
    },
    rect() {
      operations.push("rect");
    },
    arc(x: number, y: number, radius: number) {
      arcs.push({ x, y, radius });
    },
    stroke() {
      operations.push("stroke");
    },
    fill() {
      operations.push("fill");
    },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, arcs, operations, getTransform: () => currentTransform };
}

const symbol: SymbolEntity = {
  id: "symbol-1",
  entityType: "symbol",
  symbolKind: "resistor",
  reference: "R1",
  value: "10k",
  position: { x: 1_270_000, y: 2_540_000 },
  rotation: 90,
  mirrored: false,
  pins: [
    { id: "pin-1", name: "1", position: { x: 0, y: 0 } },
    { id: "pin-2", name: "2", position: { x: 1_270_000, y: 0 } },
  ],
  properties: {},
};

const viewport: Viewport = {
  offsetX: 10,
  offsetY: 20,
  zoom: 0.001,
};

describe("symbol helpers", () => {
  it("computes rotated connector anchors in world coordinates", () => {
    expect(getWorldConnectorAnchors(symbol)).toEqual({
      "pin-1": { x: 1_270_000, y: 2_540_000 },
      "pin-2": { x: 1_270_000, y: 3_810_000 },
    });
  });

  it("computes body bounds for popover anchoring and selection", () => {
    expect(getSymbolBodyBounds(symbol)).toEqual({
      minX: 1_090_000,
      minY: 2_820_000,
      maxX: 1_450_000,
      maxY: 3_530_000,
    });
  });

  it("renders symbol bodies and connector circles", () => {
    const { ctx, arcs, operations } = createContextRecorder();

    renderSymbol(ctx, symbol, viewport, { selected: true });

    expect(operations).toContain("stroke");
    expect(arcs).toHaveLength(2);
    expect(arcs[0]).toMatchObject({ x: 0, y: 0 });
    expect(arcs[1]).toMatchObject({ x: 1_270_000, y: 0 });
  });

  it("transforms mirrored points and normalizes unsupported rotations", () => {
    expect(
      transformSymbolLocalPoint(
        {
          ...symbol,
          mirrored: true,
          rotation: 180,
        },
        { x: 100_000, y: 50_000 },
      ),
    ).toEqual({ x: 1_370_000, y: 2_490_000 });

    expect(
      transformSymbolLocalPoint(
        {
          ...symbol,
          rotation: 45 as unknown as 0,
          mirrored: false,
        },
        { x: 100_000, y: 50_000 },
      ),
    ).toEqual({ x: 1_370_000, y: 2_590_000 });
  });

  it("uses preview opacity for ghost symbols", () => {
    const { ctx, getTransform } = createContextRecorder();

    renderSymbol(ctx, symbol, viewport, { preview: true });

    expect(ctx.globalAlpha).toBe(0.75);
    expect(getTransform()).toEqual({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  });
});
