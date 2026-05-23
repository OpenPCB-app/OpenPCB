import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PcbPlacedPart } from "../../../sdks";
import { applyPlacementTransform } from "../../../modules/designer/frontend/three-d/transform-helpers";

function buildPlacement(
  overrides: Partial<PcbPlacedPart> = {},
  modelRef: unknown = null,
): PcbPlacedPart {
  return {
    partId: "p1",
    componentId: "openpcb.core.component.opto.led",
    designator: "D1",
    layer: "F.Cu",
    mirrored: false,
    positionMm: { x: 10, y: 20 },
    rotationDeg: 0,
    footprint: {
      footprintId: "openpcb.core.footprint.opto.led-0603-1608metric",
      name: "LED_0603_1608Metric",
      mountType: "smd",
      preview: null,
      pinMap: null,
      model3d: {
        status: "ready",
        glbUrl: "/glb/x.glb",
        glbSha256: "deadbeef",
        sourceStepSha256: null,
        sourceFilename: null,
        modelRef,
        converterVersion: null,
      },
    },
    ...overrides,
  } as unknown as PcbPlacedPart;
}

function makeGroup(): THREE.Group {
  return new THREE.Group();
}

describe("applyPlacementTransform with modelRef", () => {
  it("tips the model 90° about X when modelRef.rotation.x = 90", () => {
    const group = makeGroup();
    // Drop a marker that lives at the model's local +Y axis. After a +90° X
    // rotation it must land on the world +Z axis.
    const marker = new THREE.Object3D();
    marker.position.set(0, 1, 0);
    group.add(marker);

    applyPlacementTransform(
      group,
      buildPlacement(
        { positionMm: { x: 0, y: 0 } },
        {
          rotation: { x: 90, y: 0, z: 0 },
        },
      ),
      1.6,
    );

    marker.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    marker.getWorldPosition(worldPos);
    expect(worldPos.x).toBeCloseTo(0, 5);
    expect(worldPos.y).toBeCloseTo(0, 5);
    expect(worldPos.z).toBeCloseTo(1, 5);
  });

  it("composes modelRef rotation BEFORE placement rotation (X tip + Z spin combine correctly)", () => {
    const group = makeGroup();
    // A marker at the model's +X axis. After (rotateX 90, rotateZ 90) the
    // expected behaviour: rotateX leaves +X alone → still +X. rotateZ (XYZ
    // Euler order, intrinsic) rotates about the NEW Z (= original -Y), so
    // Euler (90°, 0°, 90°) with Three.js "XYZ" order maps the model's +X
    // axis to world +Z. Worked out from the quaternion
    // q = (0.5, -0.5, 0.5, 0.5): the matrix's first column is (0, 0, 1).
    // Then placement adds (5, 7, 0).
    const marker = new THREE.Object3D();
    marker.position.set(1, 0, 0);
    group.add(marker);

    applyPlacementTransform(
      group,
      buildPlacement(
        { positionMm: { x: 5, y: 7 } },
        {
          rotation: { x: 90, y: 0, z: 90 },
        },
      ),
      1.6,
    );

    marker.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    marker.getWorldPosition(worldPos);
    expect(worldPos.x).toBeCloseTo(5, 5);
    expect(worldPos.y).toBeCloseTo(7, 5);
    expect(worldPos.z).toBeCloseTo(1, 5);
  });

  it("mirrors the Y axis when scale = (1, -1, 1) — the pin-header fix", () => {
    // Pin-header source GLBs put pin 2 at (0, -2.54, 0) in their own frame,
    // but the footprint expects pin 2 at (0, +2.54, 0). A Y-axis mirror
    // (scale.y = -1) is the cleanest correction: pure rotations either
    // also flip the X row direction (Z 180°) or the pin direction (X 180°).
    const group = makeGroup();
    const pin2 = new THREE.Object3D();
    pin2.position.set(0, -2.54, 0);
    group.add(pin2);

    applyPlacementTransform(
      group,
      buildPlacement(
        { positionMm: { x: 0, y: 0 } },
        { scale: { x: 1, y: -1, z: 1 } },
      ),
      1.6,
    );

    pin2.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    pin2.getWorldPosition(worldPos);
    expect(worldPos.x).toBeCloseTo(0, 5);
    expect(worldPos.y).toBeCloseTo(2.54, 5);
    expect(worldPos.z).toBeCloseTo(0, 5);
  });

  it("preserves the X row direction under a Y-only mirror (2x3 header)", () => {
    // For the 2x3 case, pin 4 sits at (+2.54, 0, 0) in the source. Y mirror
    // must leave it there; a Z-180° rotation would swap it to (-2.54, 0, 0)
    // — that's exactly the failure mode we're avoiding.
    const group = makeGroup();
    const pin4 = new THREE.Object3D();
    pin4.position.set(2.54, 0, 0);
    group.add(pin4);

    applyPlacementTransform(
      group,
      buildPlacement(
        { positionMm: { x: 0, y: 0 } },
        { scale: { x: 1, y: -1, z: 1 } },
      ),
      1.6,
    );

    pin4.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    pin4.getWorldPosition(worldPos);
    expect(worldPos.x).toBeCloseTo(2.54, 5);
    expect(worldPos.y).toBeCloseTo(0, 5);
    expect(worldPos.z).toBeCloseTo(0, 5);
  });

  it("is a no-op for the model-space transform when modelRef is null", () => {
    const group = makeGroup();
    const marker = new THREE.Object3D();
    marker.position.set(1, 2, 3);
    group.add(marker);

    applyPlacementTransform(
      group,
      buildPlacement({ positionMm: { x: 0, y: 0 } }, null),
      1.6,
    );

    marker.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    marker.getWorldPosition(worldPos);
    expect(worldPos.x).toBeCloseTo(1, 5);
    expect(worldPos.y).toBeCloseTo(2, 5);
    expect(worldPos.z).toBeCloseTo(3, 5);
  });
});
