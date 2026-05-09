import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { PcbPlacedPart } from "../../../../sdks";
import { FootprintOverlayLayer } from "./FootprintOverlayLayer";

const renderLayerMock = vi.hoisted(() => vi.fn(() => <group data-testid="mock-footprint-render-layer" />));

vi.mock("../../../../shared/frontend/canvas/scene", () => ({
  FootprintRenderLayer: renderLayerMock,
}));

function fixturePlacement(overrides: Partial<PcbPlacedPart> = {}): PcbPlacedPart {
  return {
    id: "placement-1",
    partId: "part-1",
    componentId: "component-1",
    reference: "U2",
    positionMm: { x: 10, y: 20 },
    rotationDeg: 90,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "footprint-1",
      name: "SOIC",
      mountType: "smd",
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "SOIC",
        pads: [
          {
            id: "pad-1",
            number: "1",
            centerMm: { x: -1, y: 0 },
            widthMm: 1.2,
            heightMm: 0.6,
            rotationDeg: 0,
            shape: "rect",
            layer: "F.Cu",
          },
        ],
        graphics: [],
        labels: [
          {
            id: "ref",
            text: "REF**",
            at: { x: 0, y: -2 },
            rotationDeg: 0,
            fontSizeMm: 1,
            anchorX: "center",
            anchorY: "middle",
            layer: "F.SilkS",
          },
        ],
        bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
        warnings: [],
      },
    },
    ...overrides,
  };
}

describe("FootprintOverlayLayer", () => {
  test("delegates to the shared PCB footprint renderer", () => {
    renderLayerMock.mockClear();

    const markup = renderToStaticMarkup(
      <FootprintOverlayLayer placements={[fixturePlacement()]} boardThicknessMm={1.6} />,
    );

    expect(markup).toContain("designer-3d-footprint-overlay-layer");
    expect(renderLayerMock).toHaveBeenCalledTimes(1);
    expect(renderLayerMock.mock.calls[0]?.[0]).toMatchObject({
      useLayerColors: true,
      surface: "pcb",
      placeholderSubstitutions: { reference: "U2" },
    });
  });

  test("skips placements without footprint preview data", () => {
    renderLayerMock.mockClear();
    const placement = fixturePlacement({
      footprint: {
        ...fixturePlacement().footprint,
        preview: null,
      },
    });

    renderToStaticMarkup(
      <FootprintOverlayLayer placements={[placement]} boardThicknessMm={1.6} />,
    );

    expect(renderLayerMock).not.toHaveBeenCalled();
  });
});
