import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCanvasThemeMode } from "./use-canvas-theme-mode";

function Mode() {
  return <span>{useCanvasThemeMode()}</span>;
}
afterEach(() => vi.unstubAllGlobals());

describe("canvas theme server snapshot", () => {
  it("renders deterministically without browser globals", () => {
    expect(renderToStaticMarkup(<Mode />)).toBe("<span>dark</span>");
  });
  it("does not read the client's light theme or subscribe during server rendering", () => {
    vi.stubGlobal("document", {
      documentElement: { dataset: { colorMode: "light" } },
    });
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor() {
          throw new Error("SSR must not subscribe");
        }
      },
    );
    expect(renderToStaticMarkup(<Mode />)).toBe("<span>dark</span>");
  });
});
