import { describe, expect, expectTypeOf, it } from "vitest";
import {
  GRID_PRESETS,
  NM_TO_SCENE,
  RENDER_ENGINE_COORDINATE_CONTRACT,
  Units,
  nmToScene,
  nmToSceneMm,
  sceneMmToNm,
  sceneToNm,
  snapPointToGridNm,
  snapToGrid,
  type Mm,
  type Nanometers,
  type SceneMm,
} from "./coords";

describe("render-engine coordinate contract", () => {
  it("locks the public world/scene/screen/Y-axis contract", () => {
    expect(RENDER_ENGINE_COORDINATE_CONTRACT).toEqual({
      worldUnit: "nm",
      sceneUnit: "mm",
      screenUnit: "px",
      yAxis: "up",
    });
  });

  it("uses millimeters at the scene boundary", () => {
    const oneMillimeterNm = Units.mmToNm(1);

    expect(NM_TO_SCENE).toBe(1_000_000);
    expect(nmToSceneMm(oneMillimeterNm)).toBe(1);
    expect(sceneMmToNm(1)).toBe(oneMillimeterNm);

    expectTypeOf(nmToSceneMm(oneMillimeterNm)).toEqualTypeOf<SceneMm>();
    expectTypeOf(nmToSceneMm(oneMillimeterNm)).toEqualTypeOf<Mm>();
    expectTypeOf(sceneMmToNm(1)).toEqualTypeOf<Nanometers>();
  });

  it("round-trips nanometers through explicit scene-mm helpers", () => {
    const valuesNm = [
      0,
      Units.mmToNm(0.25),
      Units.mmToNm(12.7),
      Units.mmToNm(-3.81),
    ];

    for (const valueNm of valuesNm) {
      expect(sceneMmToNm(nmToSceneMm(valueNm))).toBeCloseTo(valueNm);
    }
  });

  it("preserves Y-up sign through scene conversion", () => {
    const positiveY = Units.mmToNm(2.54);
    const negativeY = Units.mmToNm(-1.27);

    expect(nmToSceneMm(positiveY)).toBeGreaterThan(0);
    expect(nmToSceneMm(negativeY)).toBeLessThan(0);
    expect(sceneMmToNm(nmToSceneMm(positiveY))).toBe(positiveY);
    expect(sceneMmToNm(nmToSceneMm(negativeY))).toBe(negativeY);
  });

  it("keeps legacy alias helpers aligned with explicit unit names", () => {
    const valueNm = Units.mmToNm(5.08);
    const gridSizeNm = GRID_PRESETS.STANDARD;
    const pointNm = { x: 600_000, y: 700_000 };

    expect(nmToScene(valueNm)).toBe(nmToSceneMm(valueNm));
    expect(sceneToNm(1.5)).toBe(sceneMmToNm(1.5));
    expect(snapToGrid(pointNm, gridSizeNm)).toEqual(
      snapPointToGridNm(pointNm, gridSizeNm),
    );
  });

  it("snaps only nanometer-space points", () => {
    const pointNm = { x: 1_600_000, y: -700_000 };
    const snapped = snapPointToGridNm(pointNm, GRID_PRESETS.STANDARD);

    expect(snapped).toEqual({ x: 1_270_000, y: -1_270_000 });
    expectTypeOf(snapped.x).toEqualTypeOf<Nanometers>();
  });
});
