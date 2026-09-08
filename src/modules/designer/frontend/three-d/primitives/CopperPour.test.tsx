import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { DesignerPcbProjection } from "../../../../../sdks";
import { CopperPour } from "./CopperPour";

/**
 * A bare 2-layer board. The 3D pour is derived from `collectCopperZones`, so
 * what these fixtures vary is the zone rows, never the obstacles.
 */
function fixtureProjection(
  overrides: { zones?: DesignerPcbProjection["zones"] } = {},
): DesignerPcbProjection {
  return {
    designId: "design-1",
    revision: 1,
    board: {
      outline: {
        kind: "rect",
        widthMm: 40,
        heightMm: 30,
        centerMm: { x: 0, y: 0 },
      },
      layerCount: 2,
      activeLayer: "F.Cu",
      visibleLayers: ["F.Cu", "B.Cu", "Edge.Cuts"],
      designRules: {
        clearance: {
          traceToTraceMm: 0.2,
          traceToPadMm: 0.2,
          padToPadMm: 0.2,
          traceToViaMm: 0.2,
          viaToViaMm: 0.2,
          copperToBoardEdgeMm: 0.25,
        },
        minimums: {
          traceWidthMm: 0.15,
          drillSizeMm: 0.3,
          annularRingMm: 0.15,
          viaDiameterMm: 0.6,
          viaDrillMm: 0.3,
        },
      },
      netClasses: [],
      tracePresets: [0.25],
      updatedAt: "2026-09-07T00:00:00.000Z",
    },
    placements: [],
    traces: [],
    vias: [],
    freeHoles: [],
    freePads: [],
    overlayTexts: [],
    overlayShapes: [],
    zones: overrides.zones ?? [],
    keepouts: [],
    ratsnest: [],
    netNames: { "net-gnd": "GND" },
    warnings: [],
  } as unknown as DesignerPcbProjection;
}

/** `<mesh …>` occurrences only — `<meshStandardMaterial>` shares the prefix. */
function meshCount(markup: string): number {
  return markup.match(/<mesh[\s>]/g)?.length ?? 0;
}

describe("CopperPour (3D)", () => {
  test("pours nothing when no fill layer is enabled and there are no zones", () => {
    // Contract §7: 3D used to flood BOTH faces unconditionally; it now agrees
    // with Gerber and the 2D canvas.
    const markup = renderToStaticMarkup(
      <CopperPour projection={fixtureProjection()} />,
    );
    expect(markup).toContain("designer-3d-copper-pour");
    expect(meshCount(markup)).toBe(0);
  });

  test("pours only the faces that carry a board zone row", () => {
    const markup = renderToStaticMarkup(
      <CopperPour
        projection={fixtureProjection({
          zones: [
            {
              id: "board:F.Cu",
              name: null,
              enabled: true,
              lockedAt: null,
              layer: "F.Cu",
              netId: "net-gnd",
              netName: null,
              region: { kind: "board" },
              priority: 0,
              padConnection: "solid",
            },
          ],
        })}
      />,
    );
    expect(meshCount(markup)).toBe(1);
  });

  test("renders an explicit polygon zone with no board fill enabled", () => {
    const markup = renderToStaticMarkup(
      <CopperPour
        projection={fixtureProjection({
          zones: [
            {
              id: "zone-1",
              name: "GND pour",
              enabled: true,
              lockedAt: null,
              layer: "F.Cu",
              netId: "net-gnd",
              netName: "GND",
              region: {
                kind: "polygon",
                pointsMm: [
                  { x: -5, y: -5 },
                  { x: 5, y: -5 },
                  { x: 5, y: 5 },
                  { x: -5, y: 5 },
                ],
              },
              priority: 0,
            },
          ],
        })}
      />,
    );
    expect(meshCount(markup)).toBe(1);
  });

  test("a disabled zone pours nothing", () => {
    const markup = renderToStaticMarkup(
      <CopperPour
        projection={fixtureProjection({
          zones: [
            {
              id: "zone-1",
              name: null,
              enabled: false,
              lockedAt: null,
              layer: "F.Cu",
              netId: "net-gnd",
              netName: "GND",
              region: {
                kind: "polygon",
                pointsMm: [
                  { x: -5, y: -5 },
                  { x: 5, y: -5 },
                  { x: 5, y: 5 },
                  { x: -5, y: 5 },
                ],
              },
              priority: 0,
            },
          ],
        })}
      />,
    );
    expect(meshCount(markup)).toBe(0);
  });
});
