import { describe, expect, it } from "vitest";
import type { SymbolEntity, Viewport } from "../types";
import {
  getSymbolBodyBounds,
  getWorldConnectorAnchors,
  renderSymbol,
  transformSymbolLocalPoint,
} from "./symbols";

function createContextRecorder() {
  const arcs: Array<{
    x: number;
    y: number;
    radius: number;
    strokeStyle: string;
    fillStyle: string;
  }> = [];
  const operations: string[] = [];
  const textWrites: Array<{ text: string; x: number; y: number }> = [];
  const globalAlphaWrites: number[] = [];
  const defaultTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  type ContextState = {
    transform: typeof defaultTransform;
    globalAlpha: number;
    strokeStyle: string;
    fillStyle: string;
    lineWidth: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
  };
  const cloneState = (state: ContextState): ContextState => ({
    ...state,
    transform: { ...state.transform },
  });
  const stateStack: ContextState[] = [
    {
      transform: { ...defaultTransform },
      globalAlpha: 1,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
    },
  ];
  const getCurrentState = () => stateStack[stateStack.length - 1]!;

  const ctx = {
    save() {
      stateStack.push(cloneState(getCurrentState()));
    },
    restore() {
      if (stateStack.length > 1) {
        stateStack.pop();
      }
    },
    translate(x: number, y: number) {
      const state = getCurrentState();
      state.transform = {
        ...state.transform,
        x: state.transform.x + x,
        y: state.transform.y + y,
      };
    },
    rotate(rotation: number) {
      const state = getCurrentState();
      state.transform = {
        ...state.transform,
        rotation: state.transform.rotation + rotation,
      };
    },
    scale(scaleX: number, scaleY: number) {
      const state = getCurrentState();
      state.transform = {
        ...state.transform,
        scaleX: state.transform.scaleX * scaleX,
        scaleY: state.transform.scaleY * scaleY,
      };
    },
    get strokeStyle() {
      return getCurrentState().strokeStyle;
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      getCurrentState().strokeStyle = String(value);
    },
    get fillStyle() {
      return getCurrentState().fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      getCurrentState().fillStyle = String(value);
    },
    get lineWidth() {
      return getCurrentState().lineWidth;
    },
    set lineWidth(value: number) {
      getCurrentState().lineWidth = value;
    },
    get globalAlpha() {
      return getCurrentState().globalAlpha;
    },
    set globalAlpha(value: number) {
      getCurrentState().globalAlpha = value;
      globalAlphaWrites.push(value);
    },
    get font() {
      return getCurrentState().font;
    },
    set font(value: string) {
      getCurrentState().font = value;
    },
    get textAlign() {
      return getCurrentState().textAlign;
    },
    set textAlign(value: CanvasTextAlign) {
      getCurrentState().textAlign = value;
    },
    get textBaseline() {
      return getCurrentState().textBaseline;
    },
    set textBaseline(value: CanvasTextBaseline) {
      getCurrentState().textBaseline = value;
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
      arcs.push({
        x,
        y,
        radius,
        strokeStyle: getCurrentState().strokeStyle,
        fillStyle: getCurrentState().fillStyle,
      });
    },
    stroke() {
      operations.push("stroke");
    },
    fill() {
      operations.push("fill");
    },
    fillText(text: string, x: number, y: number) {
      textWrites.push({ text, x, y });
    },
  } as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    arcs,
    operations,
    textWrites,
    globalAlphaWrites,
    getTransform: () => ({ ...getCurrentState().transform }),
  };
}

const symbol: SymbolEntity = {
  id: "symbol-1",
  entityType: "symbol",
  symbolKind: "resistor",
  symbolTemplate: "resistor",
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
    const { ctx, arcs, operations, textWrites } = createContextRecorder();

    renderSymbol(ctx, symbol, viewport, { selected: true });

    expect(operations).toContain("stroke");
    expect(arcs).toHaveLength(2);
    expect(arcs[0]).toMatchObject({ x: 0, y: 0 });
    expect(arcs[1]).toMatchObject({ x: 1_270_000, y: 0 });
    expect(textWrites.map((entry) => entry.text)).toEqual([
      "R1",
      "10k",
      "1",
      "2",
    ]);
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
    const { ctx, getTransform, globalAlphaWrites, textWrites } =
      createContextRecorder();

    renderSymbol(ctx, symbol, viewport, { preview: true });

    expect(globalAlphaWrites).toContain(0.75);
    expect(ctx.globalAlpha).toBe(1);
    expect(getTransform()).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    });
    expect(textWrites).toEqual([]);
  });

  it("restores drawing state after save and restore", () => {
    const { ctx } = createContextRecorder();

    ctx.strokeStyle = "#123456";
    ctx.fillStyle = "#654321";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.6;

    ctx.save();
    ctx.strokeStyle = "#abcdef";
    ctx.fillStyle = "#fedcba";
    ctx.lineWidth = 7;
    ctx.globalAlpha = 0.25;
    ctx.restore();

    expect(ctx.strokeStyle).toBe("#123456");
    expect(ctx.fillStyle).toBe("#654321");
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.globalAlpha).toBe(0.6);
  });

  it("does not leak preview drawing state after restore", () => {
    const { ctx } = createContextRecorder();

    ctx.globalAlpha = 0.4;
    renderSymbol(ctx, symbol, viewport, { preview: true });

    expect(ctx.globalAlpha).toBe(0.4);
  });

  it("renders GND with only the KiCad value label", () => {
    const { ctx, operations, textWrites } = createContextRecorder();

    renderSymbol(
      ctx,
      {
        ...symbol,
        symbolKind: "gnd",
        symbolTemplate: "connector",
        reference: "GND",
        value: "GND",
        rotation: 0,
        pins: [{ id: "pin-gnd", name: "GND", position: { x: 0, y: 0 } }],
      },
      viewport,
    );

    expect(operations).toContain("stroke");
    expect(textWrites.map((entry) => entry.text)).toEqual(["GND"]);
  });

  it("renders a green outer ring for directly attached pins", () => {
    const { ctx, arcs } = createContextRecorder();

    renderSymbol(ctx, symbol, viewport, {
      connectedPinIds: new Set(["pin-1"]),
    });

    expect(arcs).toHaveLength(3);

    const pin1Arcs = arcs.filter((a) => a.x === 0);
    expect(pin1Arcs).toHaveLength(2);

    expect(pin1Arcs[0]!.radius).toBeGreaterThan(pin1Arcs[1]!.radius);
    expect(pin1Arcs[0]!.strokeStyle).toBe("#22c55e");
  });

  it("keeps selected pin styling inside the connected outer ring", () => {
    const { ctx, arcs } = createContextRecorder();

    renderSymbol(ctx, symbol, viewport, {
      selected: true,
      connectedPinIds: new Set(["pin-1"]),
    });

    expect(arcs).toHaveLength(3);

    const pin1Arcs = arcs.filter((a) => a.x === 0);
    expect(pin1Arcs).toHaveLength(2);

    expect(pin1Arcs[1]!.strokeStyle).toBe("#38bdf8");
    expect(pin1Arcs[1]!.fillStyle).toBe("#0f172a");

    expect(pin1Arcs[0]!.strokeStyle).toBe("#22c55e");
  });
});
