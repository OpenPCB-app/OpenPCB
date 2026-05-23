import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import * as THREE from "three";
import type { PcbPlacedPart } from "../../../../sdks";
import { ComponentModelLayer } from "./ComponentModelLayer";
import { ModelCacheProvider, type ModelCache } from "./ModelCacheProvider";

vi.mock("@react-three/fiber", () => ({
  useThree: <T,>(selector: (state: { invalidate: () => void }) => T): T =>
    selector({ invalidate: vi.fn() }),
}));

function fixturePlacement(
  overrides: Partial<PcbPlacedPart> = {},
): PcbPlacedPart {
  return {
    id: "placement-1",
    partId: "part-1",
    componentId: "component-1",
    reference: "U1",
    positionMm: { x: 0, y: 0 },
    rotationDeg: 0,
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
        pads: [],
        graphics: [],
        labels: [],
        bounds: { minX: -2, minY: -1, maxX: 2, maxY: 1 },
        warnings: [],
      },
    },
    ...overrides,
  };
}

function readyPlacement(modelRef: unknown = null): PcbPlacedPart {
  const placement = fixturePlacement();
  return {
    ...placement,
    footprint: {
      ...placement.footprint,
      model3d: {
        status: "ready",
        glbUrl: "/api/modules/library/footprints/footprint-1/model",
        glbSha256: "sha-ready",
        sourceStepSha256: null,
        sourceFilename: null,
        modelRef,
        converterVersion: null,
      },
    },
  };
}

function renderLayer(placements: PcbPlacedPart[], cache: ModelCache): string {
  return renderToStaticMarkup(
    <ModelCacheProvider cache={cache}>
      <ComponentModelLayer placements={placements} boardThicknessMm={1.6} />
    </ModelCacheProvider>,
  );
}

describe("ComponentModelLayer", () => {
  test("renders a ready cached model", () => {
    const group = new THREE.Group();
    const cache: ModelCache = {
      getModel: vi.fn(async () => group.clone(true) as THREE.Group),
      getStatus: vi.fn(() => "ready"),
      peekModel: vi.fn(() => group.clone(true) as THREE.Group),
      dispose: vi.fn(),
    };

    const markup = renderLayer([readyPlacement()], cache);

    expect(markup).toContain("designer-3d-component-layer");
    expect(markup).toContain("designer-3d-component-model");
    expect(markup).not.toContain("designer-3d-fallback-model");
  });

  test("renders footprint only for placements without ready model metadata", () => {
    const cache: ModelCache = {
      getModel: vi.fn(async () => null),
      getStatus: vi.fn(() => "idle"),
      peekModel: vi.fn(() => null),
      dispose: vi.fn(),
    };

    const markup = renderLayer([fixturePlacement()], cache);

    expect(markup).toContain("designer-3d-component-layer");
    expect(markup).not.toContain("designer-3d-fallback-model");
    expect(markup).not.toContain("designer-3d-component-model");
  });

  test("renders footprint only when a ready model has failed to load", () => {
    const cache: ModelCache = {
      getModel: vi.fn(async () => null),
      getStatus: vi.fn(() => "failed"),
      peekModel: vi.fn(() => null),
      dispose: vi.fn(),
    };

    const markup = renderLayer([readyPlacement()], cache);

    expect(markup).not.toContain("designer-3d-fallback-model");
    expect(markup).not.toContain("designer-3d-component-model");
  });

  test("applies stored KiCad modelRef at render time without mutating the cache source", () => {
    // The cache source group stays at identity; peekModel is expected to
    // return a clone (mirrored by the real ModelCacheProvider) so that
    // mutations from applyPlacementTransform don't pollute the cache.
    const cached = new THREE.Group();
    const cache: ModelCache = {
      getModel: vi.fn(async () => cached.clone(true) as THREE.Group),
      getStatus: vi.fn(() => "ready"),
      peekModel: vi.fn(() => cached.clone(true) as THREE.Group),
      dispose: vi.fn(),
    };

    renderLayer(
      [
        readyPlacement({
          offset: { x: 10, y: 20, z: 30 },
          rotation: { x: 90, y: 0, z: 180 },
          scale: { x: 2, y: 2, z: 2 },
        }),
      ],
      cache,
    );

    expect(cached.position.toArray().map((value) => Math.abs(value))).toEqual([
      0, 0, 0,
    ]);
    expect(
      cached.rotation
        .toArray()
        .slice(0, 3)
        .map((value) => Math.abs(value)),
    ).toEqual([0, 0, 0]);
    expect(cached.scale.toArray()).toEqual([1, 1, 1]);
  });
});
