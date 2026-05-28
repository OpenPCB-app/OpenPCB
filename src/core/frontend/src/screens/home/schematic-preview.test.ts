import { describe, expect, it } from "vitest";
import type { DesignerSchematicPreview } from "@sdks/designer";
import { buildSchematicPreviewGeometry } from "./schematic-preview";

function preview(
  parts: DesignerSchematicPreview["parts"],
  wires: DesignerSchematicPreview["wires"] = [],
  primitives: DesignerSchematicPreview["primitives"] = [],
): DesignerSchematicPreview {
  return {
    schemaVersion: 2,
    designId: "d1",
    revision: 1,
    parts,
    wires,
    primitives,
  };
}

describe("buildSchematicPreviewGeometry", () => {
  it("returns null for an empty design (no parts)", () => {
    expect(buildSchematicPreviewGeometry(preview([]))).toBeNull();
  });

  it("transforms a line by position and flips Y to SVG space", () => {
    // Part at world (10mm, 5mm) = (10e6, 5e6) nm, no rotation/mirror.
    const g = buildSchematicPreviewGeometry(
      preview([
        {
          positionNm: { x: 10_000_000, y: 5_000_000 },
          rotationDeg: 0,
          mirrored: false,
          bounds: null,
          pins: [],
          graphics: [
            {
              kind: "line",
              a: { x: 0, y: 0 },
              b: { x: 2, y: 0 },
              strokeWidthMm: 0.1,
            },
          ],
        },
      ]),
    );
    expect(g).not.toBeNull();
    // a → (10, -5), b → (12, -5) in SVG space.
    expect(g!.paths[0]!.d).toBe("M10 -5 L12 -5");
  });

  it("applies mirror and 90° rotation to symbol geometry", () => {
    const g = buildSchematicPreviewGeometry(
      preview([
        {
          positionNm: { x: 0, y: 0 },
          rotationDeg: 90,
          mirrored: true,
          bounds: null,
          pins: [],
          graphics: [
            {
              kind: "line",
              a: { x: 0, y: 0 },
              b: { x: 1, y: 0 },
              strokeWidthMm: 0.1,
            },
          ],
        },
      ]),
    );
    // mirror x: (1,0) → (-1,0); rotate 90°: (x',y') = (-y, x) → (0,-1);
    // world (0,-1); SVG flip Y → (0, 1).
    expect(g!.paths[0]!.d).toBe("M0 0 L0 1");
  });

  it("includes wires and produces a padded viewBox covering all geometry", () => {
    const g = buildSchematicPreviewGeometry(
      preview(
        [
          {
            positionNm: { x: 0, y: 0 },
            rotationDeg: 0,
            mirrored: false,
            bounds: null,
            graphics: [
              {
                kind: "rect",
                x: 0,
                y: 0,
                width: 4,
                height: 2,
                fill: "none",
                strokeWidthMm: 0.1,
              },
            ],
          },
        ],
        [
          {
            pointsNm: [
              { x: 0, y: 0 },
              { x: 10_000_000, y: 0 },
            ],
          },
        ],
      ),
    );
    expect(g).not.toBeNull();
    expect(g!.wires).toHaveLength(1);
    expect(g!.wires[0]).toBe("0,0 10,0");
    // World extent x:[0,10], y:[-2,0] → padded viewBox starts below mins.
    const [minX, minY] = g!.viewBox.split(" ").map(Number);
    expect(minX).toBeLessThan(0);
    expect(minY).toBeLessThan(-2);
  });

  it("renders pin stubs as paths and records anchor dots", () => {
    const g = buildSchematicPreviewGeometry(
      preview([
        {
          positionNm: { x: 0, y: 0 },
          rotationDeg: 0,
          mirrored: false,
          bounds: null,
          pins: [{ anchor: { x: 0, y: 0 }, bodyEnd: { x: 2.54, y: 0 } }],
          graphics: [],
        },
      ]),
    );
    expect(g).not.toBeNull();
    // anchor (0,0) → bodyEnd (2.54,0); Y-flip leaves y at 0.
    expect(g!.paths[0]!.d).toBe("M0 0 L2.54 0");
    expect(g!.dots).toEqual([{ x: 0, y: 0 }]);
  });

  it("renders a primitive's templated segments and connection dot", () => {
    const g = buildSchematicPreviewGeometry(
      preview(
        [
          {
            positionNm: { x: 0, y: 0 },
            rotationDeg: 0,
            mirrored: false,
            bounds: null,
            pins: [],
            graphics: [
              {
                kind: "line",
                a: { x: 0, y: 0 },
                b: { x: 1, y: 0 },
                strokeWidthMm: 0.1,
              },
            ],
          },
        ],
        [],
        [{ kind: "gnd", positionNm: { x: 5_000_000, y: 0 }, rotationDeg: 0 }],
      ),
    );
    expect(g).not.toBeNull();
    // 1 part line + 4 GND segments = 5 paths.
    expect(g!.paths).toHaveLength(5);
    // GND connection point at its position (5mm, 0) → SVG (5, 0).
    expect(g!.dots).toContainEqual({ x: 5, y: 0 });
  });
});
