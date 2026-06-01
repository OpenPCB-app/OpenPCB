import { describe, expect, test } from "vitest";
import * as THREE from "three";
import type { PcbPlacedPart } from "../../../../sdks";
import {
  applyPlacementTransform,
  getFallbackBoxSize,
  getPlacementTransformProps,
} from "./transform-helpers";

function fixturePlacement(
  overrides: Partial<PcbPlacedPart> = {},
): PcbPlacedPart {
  return {
    id: "placement-1",
    partId: "part-1",
    componentId: "component-1",
    reference: "U1",
    positionMm: { x: 10, y: 20 },
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
        pads: [
          {
            id: "pad-1",
            number: "1",
            shape: "rect",
            centerMm: { x: -1, y: 0 },
            widthMm: 0.8,
            heightMm: 1,
            rotationDeg: 0,
            layer: "F.Cu",
          },
          {
            id: "pad-2",
            number: "2",
            shape: "rect",
            centerMm: { x: 1, y: 0 },
            widthMm: 0.8,
            heightMm: 1,
            rotationDeg: 0,
            layer: "F.Cu",
          },
        ],
        graphics: [],
        labels: [],
        bounds: { minX: -2, minY: -1.5, maxX: 2, maxY: 1.5 },
        warnings: [],
      },
    },
    ...overrides,
  };
}

describe("3D component transform helpers", () => {
  test("uses PCB XY coordinates and rotates placements around world Z", () => {
    const group = new THREE.Group();
    applyPlacementTransform(group, fixturePlacement({ rotationDeg: 90 }), 1.6);

    expect(group.position.x).toBeCloseTo(10);
    expect(group.position.y).toBeCloseTo(20);
    expect(group.position.z).toBeCloseTo(0);
    expect(group.rotation.z).toBeCloseTo(Math.PI / 2);
  });

  test("mirrors back-layer placements on X and moves them to negative Z", () => {
    const transform = getPlacementTransformProps(
      fixturePlacement({ layer: "B.Cu" }),
      1.6,
    );

    expect(transform.position).toEqual([10, 20, -1.6]);
    expect(transform.scale).toEqual([-1, 1, 1]);
  });

  function placementWithFrozenModelRef(modelRef: unknown): PcbPlacedPart {
    const base = fixturePlacement({ positionMm: { x: 0, y: 0 } });
    return {
      ...base,
      footprint: {
        ...base.footprint,
        model3d: {
          status: "ready",
          glbUrl: "/model",
          glbSha256: "sha",
          sourceStepSha256: null,
          sourceFilename: null,
          modelRef,
          converterVersion: null,
        },
      },
    };
  }

  test("applies the frozen snapshot modelRef when no override is supplied", () => {
    const group = new THREE.Group();
    applyPlacementTransform(
      group,
      placementWithFrozenModelRef({ rotation: { x: -90, y: 0, z: 0 } }),
      1.6,
    );
    expect(group.rotation.x).toBeCloseTo(-Math.PI / 2);
  });

  test("an explicit null override ignores a stale frozen snapshot modelRef", () => {
    // The live library descriptor declares no correction (modelRef cleared);
    // the stale frozen {x:-90} must NOT be applied.
    const group = new THREE.Group();
    applyPlacementTransform(
      group,
      placementWithFrozenModelRef({ rotation: { x: -90, y: 0, z: 0 } }),
      1.6,
      null,
    );
    expect(group.rotation.x).toBeCloseTo(0);
    expect(group.rotation.y).toBeCloseTo(0);
    expect(group.rotation.z).toBeCloseTo(0);
  });

  test("an explicit override modelRef wins over the frozen snapshot", () => {
    const group = new THREE.Group();
    applyPlacementTransform(
      group,
      placementWithFrozenModelRef({ rotation: { x: -90, y: 0, z: 0 } }),
      1.6,
      { rotation: { x: 0, y: 0, z: 45 } },
    );
    expect(group.rotation.x).toBeCloseTo(0);
    expect(group.rotation.z).toBeCloseTo(Math.PI / 4);
  });

  test("derives fallback box size from footprint bounds", () => {
    expect(getFallbackBoxSize(fixturePlacement())).toEqual({
      widthMm: 4,
      depthMm: 3,
      heightMm: 1.5,
    });
  });
});
