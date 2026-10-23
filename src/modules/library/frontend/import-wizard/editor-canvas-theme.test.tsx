// @vitest-environment happy-dom
import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SymbolEditorCanvas } from "./editor/SymbolEditorCanvas";
import { FootprintEditorCanvas } from "./footprint-editor/FootprintEditorCanvas";

const canvasProps = vi.hoisted(
  () => new Map<string, { backgroundColor?: string; themeMode?: string }>(),
);

// These children never render through the canvas double. Their real barrels
// eagerly preload Troika fonts, unrelated to editor theme propagation.
vi.mock("../../../../shared/frontend/canvas/primitives", () => ({
  GridShader: () => null,
  EDAText: () => null,
}));
vi.mock("../../../../shared/frontend/canvas/scene", () => ({
  SymbolRenderLayer: () => null,
  FootprintRenderLayer: () => null,
}));

vi.mock("../../../../shared/frontend/canvas/interaction", () => ({
  EdaCanvas: (props: {
    backgroundColor?: string;
    themeMode?: string;
    initialZoom?: number;
  }) => {
    canvasProps.set(String(props.initialZoom), {
      backgroundColor: props.backgroundColor,
      themeMode: props.themeMode,
    });
    return null;
  },
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  canvasProps.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.documentElement.dataset.colorMode;
});

async function setTheme(mode: "light" | "dark"): Promise<void> {
  await act(async () => {
    document.documentElement.dataset.colorMode = mode;
    // MutationObserver callbacks run as microtasks.
    await Promise.resolve();
  });
}

async function renderCanvas(element: ReactElement) {
  await act(async () => root.render(element));
  expect(canvasProps.size).toBe(1);
  return () => [...canvasProps.values()][0];
}

describe("library editor canvases follow the app theme", () => {
  it("symbol editor uses the schematic recipe and updates live", async () => {
    await setTheme("light");
    const props = await renderCanvas(<SymbolEditorCanvas />);
    expect(props()).toEqual({ themeMode: "light", backgroundColor: "#f0f4fb" });

    await setTheme("dark");
    expect(props()).toEqual({ themeMode: "dark", backgroundColor: undefined });
  });

  it("footprint editor uses the PCB recipe and updates live", async () => {
    await setTheme("dark");
    const props = await renderCanvas(<FootprintEditorCanvas />);
    expect(props()).toEqual({ themeMode: "dark", backgroundColor: "#0e1116" });

    await setTheme("light");
    expect(props()).toEqual({ themeMode: "light", backgroundColor: "#0e1116" });
  });
});
