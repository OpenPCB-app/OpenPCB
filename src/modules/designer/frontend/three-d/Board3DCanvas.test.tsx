import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DesignerPcbProjection } from "../../../../sdks";
import { Board3DCanvas } from "./Board3DCanvas";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    frameloop,
    children,
  }: {
    frameloop?: string;
    children?: React.ReactNode;
  }) => (
    <div data-testid="mock-r3f-canvas" data-frameloop={frameloop}>
      {children}
    </div>
  ),
  useThree: <T,>(selector: (state: { invalidate: () => void }) => T): T =>
    selector({ invalidate: mocks.invalidate }),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: ({ makeDefault }: { makeDefault?: boolean }) => (
    <div
      data-testid="mock-orbit-controls"
      data-make-default={String(makeDefault)}
    />
  ),
  Text: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Environment: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-environment">{children}</div>
  ),
  Lightformer: () => null,
  ContactShadows: () => null,
}));

vi.mock("@react-three/postprocessing", () => ({
  EffectComposer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-effectcomposer">{children}</div>
  ),
  N8AO: () => null,
  SMAA: () => null,
  ToneMapping: () => null,
}));

vi.mock("postprocessing", () => ({
  ToneMappingMode: { ACES_FILMIC: 4 },
}));

function fixtureProjection(): DesignerPcbProjection {
  return {
    designId: "design-1",
    revision: 3,
    board: {
      outline: {
        kind: "rect",
        widthMm: 100,
        heightMm: 80,
        centerMm: { x: 0, y: 0 },
      },
      activeLayer: "F.Cu",
      visibleLayers: ["F.Cu", "B.Cu", "F.SilkS", "B.SilkS", "Edge.Cuts"],
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
      updatedAt: "2026-05-09T00:00:00.000Z",
    },
    placements: [],
    traces: [],
    vias: [],
    freeHoles: [],
    freePads: [],
    overlayTexts: [],
    overlayShapes: [],
    zones: [],
    ratsnest: [],
    netNames: {},
    warnings: [],
  };
}

describe("Board3DCanvas", () => {
  afterEach(() => {
    mocks.invalidate.mockClear();
  });

  test("renders a demand-frameloop R3F canvas", () => {
    const projection = fixtureProjection();

    const markup = renderToStaticMarkup(
      <Board3DCanvas
        moduleId="designer"
        selectedDesignId="design-1"
        projection={projection}
        loadingProjection={false}
        error={null}
      />,
    );

    expect(markup).toContain("designer-3d-canvas");
    expect(markup).toContain("mock-r3f-canvas");
    expect(markup).toContain('data-frameloop="demand"');
    expect(markup).toContain("mock-orbit-controls");
    expect(markup).toContain('data-make-default="true"');
  });
});
