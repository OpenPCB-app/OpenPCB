/**
 * Unit pins for the three fabricator-capability codes the golden suite alone
 * did not cover before S7 WP4 (`golden-census-2l` provokes all three, but a
 * dedicated unit test pins each independent of that fixture's other content —
 * batch-DRC contract 06 §3 fab tier, jlcpcb_2l preset values from
 * `fab-presets.ts`): `FAB_CLEARANCE`, `FAB_HOLE_TO_HOLE`, `FAB_PAD`.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import {
  boardWithRules,
  codes,
  freeHole,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

describe("DRC fab tier (jlcpcb_2l)", () => {
  test("FAB_CLEARANCE: gap passes the board rule but fails the fab minimum", () => {
    // Board rule relaxed to 0.05 mm; jlcpcb_2l's minClearanceMm is 0.1 mm.
    // Two 0.2 mm traces with a 0.08 mm edge gap: 0.08 >= 0.05 (board rule OK),
    // 0.08 < 0.1 (fab floor fails) -> FAB_CLEARANCE, not TRACE_TO_TRACE_CLEARANCE.
    const report = runDrc(
      projection({
        board: boardWithRules({
          fabricator: "jlcpcb_2l",
          clearance: { traceToTraceMm: 0.05 },
          // The default net class's own 0.25 mm clearanceMm would otherwise
          // dominate (required = max(board rule, class)) and mask the fab
          // tier behind an ordinary TRACE_TO_TRACE_CLEARANCE.
          netClasses: [
            {
              id: "default",
              name: "Default",
              traceWidthMm: 0.2,
              clearanceMm: 0.05,
              viaDiameterMm: 0.8,
              viaDrillMm: 0.4,
              color: "#ccc",
              defaultViaProtection: "tented",
            },
          ],
        }),
        netNames: { n1: "A", n2: "B" },
        traces: [
          trace("a", "n1", [[0, 0], [10, 0]]),
          trace("b", "n2", [[0, 0.28], [10, 0.28]]),
        ],
      }),
    );
    expect(codes(report)).toContain("FAB_CLEARANCE");
    expect(codes(report)).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("FAB_HOLE_TO_HOLE: gap passes the board rule but fails jlcpcb_2l's PTH/NPTH floor", () => {
    // Board holeToHoleMm default 0.25 mm; jlcpcb_2l's holeToHolePthMm is
    // 0.45 mm. Two 0.6 mm-drill free holes 1.0 mm apart (center-to-center):
    // edge gap 0.4 mm — passes 0.25, fails 0.45 -> FAB_HOLE_TO_HOLE only.
    const report = runDrc(
      projection({
        board: boardWithRules({ fabricator: "jlcpcb_2l" }),
        freeHoles: [
          freeHole("h1", { x: 0, y: 0 }, 0.6),
          freeHole("h2", { x: 1.0, y: 0 }, 0.6),
        ],
      }),
    );
    expect(codes(report)).toContain("FAB_HOLE_TO_HOLE");
    expect(codes(report)).not.toContain("HOLE_TO_HOLE");
  });

  test("FAB_PAD: via pad diameter below jlcpcb_2l's minPadMm", () => {
    // jlcpcb_2l minPadMm is 0.25 mm; a 0.2 mm via pad fails it (and also the
    // board's own 0.8 mm minimum, which always fires first when tighter —
    // this test only asserts FAB_PAD is present, not that it fires alone).
    const report = runDrc(
      projection({
        board: boardWithRules({ fabricator: "jlcpcb_2l" }),
        vias: [via("v1", { netId: "n1", diameterMm: 0.2, drillMm: 0.15 })],
      }),
    );
    expect(codes(report)).toContain("FAB_PAD");
  });
});
