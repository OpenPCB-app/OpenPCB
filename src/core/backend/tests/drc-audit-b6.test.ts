/**
 * Audit batch B6 — findings raised by the S7 Astra adversarial-verify that are
 * owned by a LATER session. One `test.todo` per open finding, each body a real
 * post-fix assertion (docs/drc/OPEN_FINDINGS.md "Checking status").
 */
import { describe, expect, test } from "bun:test";
import { buildGerberLayer } from "../../../modules/designer/backend/export/gerber/writer";
import { pad, placement, projection } from "./helpers/drc-fixtures";

describe("audit B6 — export parity (S11)", () => {
  test.todo("B6-1: a 45° rotated rectangular pad exports rotated copper", () => {
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
    // Today: `%ADD10R,0.2X2*%` flashed axis-aligned — the copper DRC judged
    // (`padOutlineWorldMm`, rotated 45°) is not the copper the fab receives.
    // Post-fix: either a load-rotation (`%LR45*%`) precedes the flash, or the
    // pad is emitted as a rotated aperture macro / region.
    expect(/%LR45(\.0*)?\*%/.test(gerber) || /%AM/.test(gerber)).toBe(true);
  });
});
