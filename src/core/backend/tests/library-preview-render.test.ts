import { describe, expect, test } from "bun:test";
import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "@openpcb/rendering-core";
import {
  renderFootprintToSvg,
  renderSymbolToSvg,
} from "../../../modules/library/backend/preview/render-svg";

const BASE_SYMBOL: Omit<SymbolRenderModel, "graphics" | "pins" | "bounds"> = {
  kind: "symbol",
  units: "mm",
  name: "Test",
  unitCount: 1,
  labels: [],
  warnings: [],
};

describe("renderSymbolToSvg", () => {
  test("body rect with fill=solid renders outline-only (KiCad convention)", () => {
    const model: SymbolRenderModel = {
      ...BASE_SYMBOL,
      graphics: [
        {
          kind: "rect",
          x: -5,
          y: -5,
          width: 10,
          height: 10,
          fill: "solid",
          strokeWidthMm: 0.2,
        },
      ],
      pins: [
        {
          id: "p1",
          name: "VCC",
          number: "1",
          electricalType: "passive",
          unit: 1,
          anchor: { x: -8, y: 2.5 },
          bodyEnd: { x: -5, y: 2.5 },
          rotationDeg: 0,
        },
      ],
      bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    };
    const svg = renderSymbolToSvg(model);

    // Rect must not be filled — would obscure pin labels / interior detail.
    const rectMatch = svg.match(/<rect [^/]*?\/>/);
    expect(rectMatch).toBeTruthy();
    expect(rectMatch?.[0]).toContain('fill="none"');
  });

  test("viewBox encompasses pin anchors even when model bounds omit them", () => {
    const model: SymbolRenderModel = {
      ...BASE_SYMBOL,
      graphics: [
        {
          kind: "rect",
          x: -2,
          y: -2,
          width: 4,
          height: 4,
          fill: "solid",
          strokeWidthMm: 0.2,
        },
      ],
      pins: [
        {
          id: "p1",
          name: "A",
          number: "1",
          electricalType: "passive",
          unit: 1,
          anchor: { x: -10, y: 0 },
          bodyEnd: { x: -2, y: 0 },
          rotationDeg: 0,
        },
      ],
      // Bounds intentionally tight to body — pre-fix bug clipped pins.
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    };
    const svg = renderSymbolToSvg(model);
    const vbMatch = svg.match(/viewBox="([\d.\-\s]+)"/);
    expect(vbMatch).toBeTruthy();
    const [vx, , vw] = vbMatch![1]!.split(/\s+/).map(Number);
    // The bounds frame is translated so left-most model point lands at x=0;
    // the viewBox width must therefore cover pin anchor (-10) through body
    // (+2) = 12 mm of model space, plus 2× padding.
    expect(vx).toBe(0);
    expect(vw!).toBeGreaterThanOrEqual(12);
  });

  test("embeds prefers-color-scheme styling so img tag renders in both themes", () => {
    const model: SymbolRenderModel = {
      ...BASE_SYMBOL,
      graphics: [],
      pins: [],
      bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    };
    const svg = renderSymbolToSvg(model);
    expect(svg).toContain("<style>");
    expect(svg).toContain("prefers-color-scheme");
    expect(svg).toContain("dark");
  });
});

describe("renderFootprintToSvg", () => {
  test("solid-fill rect on footprint silkscreen keeps the fill (no symbol body convention here)", () => {
    const model: FootprintRenderModel = {
      kind: "footprint",
      units: "mm",
      name: "F",
      pads: [],
      graphics: [
        {
          kind: "rect",
          x: 0,
          y: 0,
          width: 5,
          height: 5,
          fill: "solid",
          strokeWidthMm: 0.15,
        },
      ],
      labels: [],
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
      warnings: [],
    };
    const svg = renderFootprintToSvg(model);
    const rectMatch = svg.match(/<rect [^/]*?\/>/);
    expect(rectMatch?.[0]).not.toContain('fill="none"');
  });
});
