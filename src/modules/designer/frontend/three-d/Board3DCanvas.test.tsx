import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import type { DesignerPcbProjection } from "../../../../sdks";
import {
  applyDollyToCursor,
  applyPan,
  applyRotate,
  Board3DCanvas,
} from "./Board3DCanvas";

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

/** A camera looking at `target` from `+dist` on Z, with matrices ready to use. */
function cameraLookingAt(target: Vector3, dist: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(45, 1, 0.1, 1000);
  cam.position.set(target.x, target.y, target.z + dist);
  cam.lookAt(target);
  cam.updateMatrix();
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

function wheel(partial: Partial<WheelEvent>): WheelEvent {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    ...partial,
  } as unknown as WheelEvent;
}

describe("applyDollyToCursor", () => {
  test("zoom-in (positive delta) moves the camera closer to the target", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    const changed = applyDollyToCursor(cam, target, 0.2, 0, 0);
    expect(changed).toBe(true);
    const dist = cam.position.distanceTo(target);
    expect(dist).toBeLessThan(100);
    expect(dist).toBeGreaterThan(80);
  });

  test("centered cursor dollies straight toward the target (target unchanged)", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    applyDollyToCursor(cam, target, 0.2, 0, 0);
    // pivot == target when the cursor is centered, so the orbit point holds.
    expect(target.length()).toBeLessThan(1e-6);
  });

  test("clamps to the minimum distance on an aggressive zoom-in", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    applyDollyToCursor(cam, target, 10, 0, 0);
    expect(cam.position.distanceTo(target)).toBeCloseTo(8, 5); // DOLLY_MIN_DISTANCE
  });

  test("clamps to the maximum distance on an aggressive zoom-out", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    applyDollyToCursor(cam, target, -10, 0, 0);
    expect(cam.position.distanceTo(target)).toBeCloseTo(400, 5); // DOLLY_MAX_DISTANCE
  });

  test("keeps the pointed-at world point under the cursor (off-center)", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    const ndcX = 0.5;
    const ndcY = 0.3;
    // The world point under the cursor, on the focal plane, before dollying.
    const before = new Vector3(ndcX, ndcY, 0.5)
      .unproject(cam)
      .sub(cam.position)
      .normalize();
    const fwd = target.clone().sub(cam.position).normalize();
    const pivot = cam.position
      .clone()
      .addScaledVector(
        before,
        target.clone().sub(cam.position).dot(fwd) / before.dot(fwd),
      );

    applyDollyToCursor(cam, target, 0.3, ndcX, ndcY);

    // Re-orient (controls.update() does lookAt) then re-project the pivot.
    cam.lookAt(target);
    cam.updateMatrix();
    cam.updateMatrixWorld(true);
    const projected = pivot.clone().project(cam);
    expect(projected.x).toBeCloseTo(ndcX, 4);
    expect(projected.y).toBeCloseTo(ndcY, 4);
  });

  test("is a no-op for zero delta", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    expect(applyDollyToCursor(cam, target, 0, 0, 0)).toBe(false);
    expect(cam.position.z).toBe(100);
  });
});

describe("applyPan", () => {
  test("moves camera and target by the same vector (view direction preserved)", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    const offsetBefore = cam.position.clone().sub(target);
    const changed = applyPan(
      cam,
      target,
      wheel({ deltaX: 10, deltaY: 20 }),
      800,
    );
    expect(changed).toBe(true);
    const offsetAfter = cam.position.clone().sub(target);
    expect(offsetAfter.distanceTo(offsetBefore)).toBeLessThan(1e-6);
    // Looking down -Z with default up, a rightward swipe trucks the camera +X.
    expect(cam.position.x).toBeGreaterThan(0);
    expect(target.x).toBeGreaterThan(0);
  });

  test("pan magnitude scales with view distance", () => {
    const near = cameraLookingAt(new Vector3(0, 0, 0), 100);
    const nearTarget = new Vector3(0, 0, 0);
    applyPan(near, nearTarget, wheel({ deltaX: 10 }), 800);

    const far = cameraLookingAt(new Vector3(0, 0, 0), 200);
    const farTarget = new Vector3(0, 0, 0);
    applyPan(far, farTarget, wheel({ deltaX: 10 }), 800);

    expect(Math.abs(farTarget.x)).toBeCloseTo(Math.abs(nearTarget.x) * 2, 4);
  });

  test("is a no-op for zero deltas", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    expect(applyPan(cam, target, wheel({ deltaX: 0, deltaY: 0 }), 800)).toBe(
      false,
    );
  });
});

describe("applyRotate", () => {
  test("horizontal swipe orbits in azimuth, preserving radius and target", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    const changed = applyRotate(cam, target, wheel({ deltaX: 80 }), 800);
    expect(changed).toBe(true);
    expect(cam.position.distanceTo(target)).toBeCloseTo(100, 4); // radius held
    expect(Math.abs(cam.position.x)).toBeGreaterThan(1); // swung around the pole
    expect(target.length()).toBeLessThan(1e-6); // orbit pivot unchanged
  });

  test("vertical swipe orbits in polar angle", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    applyRotate(cam, target, wheel({ deltaY: 80 }), 800);
    expect(cam.position.distanceTo(target)).toBeCloseTo(100, 4);
    expect(Math.abs(cam.position.y)).toBeGreaterThan(1);
  });

  test("is a no-op for zero deltas", () => {
    const target = new Vector3(0, 0, 0);
    const cam = cameraLookingAt(target, 100);
    expect(applyRotate(cam, target, wheel({ deltaX: 0, deltaY: 0 }), 800)).toBe(
      false,
    );
  });
});
