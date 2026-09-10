/**
 * Audit batch B6 — findings raised by the S7 Astra adversarial-verify that are
 * owned by a LATER session. One `test.todo` per open finding, each body a real
 * post-fix assertion (docs/drc/OPEN_FINDINGS.md "Checking status").
 */
import { describe, expect, test } from "bun:test";
import { buildGerberLayer } from "../../../modules/designer/backend/export/gerber/writer";
import { padOutlineWorldMm } from "../../../shared/pcb-geometry/pad-outline";
import { placementPads } from "../../../shared/pcb-geometry/pad-geometry";
import { insidePrimitives, parseGerber } from "./helpers/gerber-parse";
import { pad, placement, projection } from "./helpers/drc-fixtures";

describe("audit B6 — export parity (S11)", () => {
  test("B6-1: a 45° rotated rectangular pad exports rotated copper", () => {
    const proj = projection({
      placements: [
        placement("A", {
          positionMm: { x: 10, y: 10 },
          pads: [pad("1", { x: 0, y: 0 }, 2, 0.2, { rotationDeg: 45 })],
        }),
      ],
      padNets: { "A|1": "n1" },
      netNames: { n1: "A" },
    });
    const gerber = buildGerberLayer(proj, "copper.top", []);
    // Before S11: `%ADD10R,0.2X2*%` flashed axis-aligned — the copper DRC
    // judged (`padOutlineWorldMm`, rotated 45°) is not the copper the fab
    // receives. Post-fix: the pad is a rotated aperture MACRO.
    expect(/%LR45(\.0*)?\*%/.test(gerber) || /%AM/.test(gerber)).toBe(true);

    // …and the macro's expansion IS that copper. The pad is a rectangle, so
    // `padOutlineWorldMm` is exact (four corners, no circumscribed arc), and
    // the flashed region must contain each corner pulled 2e-6 mm toward the
    // centre and exclude it pushed 2e-6 mm out — boundary agreement at the
    // §6.5 tolerance.
    const parsed = parseGerber(gerber);
    expect(parsed.flashes).toHaveLength(1);
    const flash = parsed.flashes[0]!;
    const aperture = parsed.apertures.get(flash.code);
    expect(aperture).toBeDefined();
    expect(aperture!.definition).toMatch(/%ADD\d+ROT_R_2_0p2_45\*%/);

    const source = placementPads(proj.placements[0]!)[0]!;
    const ring = padOutlineWorldMm(proj.placements[0]!, source);
    expect(ring).toHaveLength(4);
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    expect(Math.abs(flash.xMm - cx)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(flash.yMm - cy)).toBeLessThanOrEqual(1e-6);
    for (const corner of ring) {
      const dx = corner.x - cx;
      const dy = corner.y - cy;
      const len = Math.hypot(dx, dy);
      const inScale = (len - 2e-6) / len;
      const outScale = (len + 2e-6) / len;
      // Aperture-frame coordinates: the flash point is the aperture origin.
      const ox = cx - flash.xMm;
      const oy = cy - flash.yMm;
      expect(
        insidePrimitives(
          aperture!.primitives,
          dx * inScale + ox,
          dy * inScale + oy,
        ),
      ).toBe(true);
      expect(
        insidePrimitives(
          aperture!.primitives,
          dx * outScale + ox,
          dy * outScale + oy,
        ),
      ).toBe(false);
    }
  });
});
