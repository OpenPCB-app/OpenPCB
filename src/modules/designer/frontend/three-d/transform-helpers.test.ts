import { describe, expect, test } from "vitest";
import * as THREE from "three";
import type { PcbPlacedPart } from "../../../../sdks";
import {
  applyPlacementTransform,
  getFallbackBoxSize,
  getModelPlacementTransformProps,
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

// KiCad 8.0.4 `3d-viewer/3d_rendering/opengl/render_3d_opengl.cpp`,
// `RENDER_3D_OPENGL::get3dModelsFromFootprint` (lines 966-1037), rebuilt step
// by step with glm's right-multiply semantics (`m = m · op`). Board Y is
// negated on entry (line 974), which is exactly canonical C, so positions are
// passed here in C. `zpos` stands in for `GetFootprintZPos` (bottom = −t).
function kicadModelWorldMatrix(input: {
  positionC: { x: number; y: number };
  zpos: number;
  orientationDeg: number;
  flipped: boolean;
  offset: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}): THREE.Matrix4 {
  const rad = THREE.MathUtils.degToRad;
  const m = new THREE.Matrix4().makeTranslation(
    input.positionC.x,
    input.positionC.y,
    input.zpos,
  );
  m.multiply(new THREE.Matrix4().makeRotationZ(rad(input.orientationDeg)));
  if (input.flipped) {
    m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    m.multiply(new THREE.Matrix4().makeRotationZ(Math.PI));
  }
  m.multiply(
    new THREE.Matrix4().makeTranslation(
      input.offset.x,
      input.offset.y,
      input.offset.z,
    ),
  );
  m.multiply(new THREE.Matrix4().makeRotationZ(rad(-input.rotation.z)));
  m.multiply(new THREE.Matrix4().makeRotationY(rad(-input.rotation.y)));
  m.multiply(new THREE.Matrix4().makeRotationX(rad(-input.rotation.x)));
  m.multiply(
    new THREE.Matrix4().makeScale(input.scale.x, input.scale.y, input.scale.z),
  );
  return m;
}

function expectMatricesClose(actual: THREE.Matrix4, expected: THREE.Matrix4) {
  actual.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.elements[index], 9);
  });
}

function groupMatrix(group: THREE.Group): THREE.Matrix4 {
  group.updateMatrix();
  return group.matrix.clone();
}

const KICAD_REF = {
  path: "${KICAD8_3DMODEL_DIR}/Package_TO_SOT_SMD.3dshapes/SOT-23.wrl",
  resolvedFileName: "SOT-23.wrl",
  offset: { x: 0.3, y: -0.2, z: 0.1 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 10, y: 20, z: 30 },
};

describe("3D back-side model frame (KF1, OP6)", () => {
  test("back-side model scale is a proper rotation; the 2D overlay is unchanged", () => {
    const back = fixturePlacement({ layer: "B.Cu", mirrored: true });
    const model = getModelPlacementTransformProps(back, 1.6);
    const overlay = getPlacementTransformProps(back, 1.6);

    expect(model.scale).toEqual([-1, 1, -1]);
    expect(model.scale[0] * model.scale[1] * model.scale[2]).toBe(1);
    expect(model.position).toEqual([10, 20, -1.6]);
    expect(overlay.scale).toEqual([-1, 1, 1]);
    expect(overlay.position).toEqual([10, 20, -1.6]);
  });

  test("front-side model transform equals the overlay transform", () => {
    const front = fixturePlacement({ rotationDeg: 45 });
    expect(getModelPlacementTransformProps(front, 1.6)).toEqual(
      getPlacementTransformProps(front, 1.6),
    );
  });

  test("a back-side model hangs below the board with its XY footprint mirrored like the overlay", () => {
    const group = new THREE.Group();
    const bodyTop = new THREE.Object3D();
    bodyTop.position.set(0, 0, 1);
    const pin1 = new THREE.Object3D();
    pin1.position.set(-1, 0.5, 0);
    group.add(bodyTop, pin1);

    applyPlacementTransform(group, fixturePlacement({ layer: "B.Cu" }), 1.6);
    group.updateMatrixWorld(true);

    expect(groupMatrix(group).determinant()).toBeCloseTo(1, 9);
    const top = bodyTop.getWorldPosition(new THREE.Vector3());
    expect(top.x).toBeCloseTo(10);
    expect(top.y).toBeCloseTo(20);
    expect(top.z).toBeCloseTo(-2.6);
    // Same XY as the overlay's (−1,1,1) mapping of a pad at (−1, 0.5).
    const pin = pin1.getWorldPosition(new THREE.Vector3());
    expect(pin.x).toBeCloseTo(11);
    expect(pin.y).toBeCloseTo(20.5);
    expect(pin.z).toBeCloseTo(-1.6);
  });

  test("KiCad (rotate) is applied as rotZ(−z)·rotY(−y)·rotX(−x) after (offset)", () => {
    const group = new THREE.Group();
    applyPlacementTransform(
      group,
      fixturePlacement({ positionMm: { x: 0, y: 0 } }),
      1.6,
      KICAD_REF,
    );

    expectMatricesClose(
      groupMatrix(group),
      kicadModelWorldMatrix({
        positionC: { x: 0, y: 0 },
        zpos: 0,
        orientationDeg: 0,
        flipped: false,
        offset: KICAD_REF.offset,
        rotation: KICAD_REF.rotation,
        scale: KICAD_REF.scale,
      }),
    );
  });

  test("a non-KiCad (CoreLibrary) modelRef keeps the authored XYZ rotation", () => {
    const rotation = { x: 10, y: 20, z: 30 };
    const group = new THREE.Group();
    applyPlacementTransform(
      group,
      fixturePlacement({ positionMm: { x: 0, y: 0 } }),
      1.6,
      { rotation },
    );
    const rad = THREE.MathUtils.degToRad;
    const expected = new THREE.Matrix4()
      .makeRotationX(rad(rotation.x))
      .multiply(new THREE.Matrix4().makeRotationY(rad(rotation.y)))
      .multiply(new THREE.Matrix4().makeRotationZ(rad(rotation.z)));

    expectMatricesClose(groupMatrix(group), expected);
  });

  test.each([0, 90, 180, 270, -30])(
    "an imported back-side part (KiCad θ=%d, stored θ+180, mirrored) renders like KiCad's flipped model",
    (thetaK) => {
      const group = new THREE.Group();
      applyPlacementTransform(
        group,
        fixturePlacement({
          positionMm: { x: 12.5, y: -7.25 },
          rotationDeg: (((thetaK + 180) % 360) + 360) % 360,
          mirrored: true,
          layer: "B.Cu",
        }),
        1.6,
        { ...KICAD_REF, scale: { x: 1, y: 1.5, z: 2 } },
      );

      const expected = kicadModelWorldMatrix({
        positionC: { x: 12.5, y: -7.25 },
        zpos: -1.6,
        orientationDeg: thetaK,
        flipped: true,
        offset: KICAD_REF.offset,
        rotation: KICAD_REF.rotation,
        scale: { x: 1, y: 1.5, z: 2 },
      });
      expectMatricesClose(groupMatrix(group), expected);
      expect(expected.determinant()).toBeGreaterThan(0);
    },
  );
});
