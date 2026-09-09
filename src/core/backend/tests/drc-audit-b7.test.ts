/**
 * Audit regression suite B7 — findings registered by the S8 live-parity
 * session (docs/drc/OPEN_FINDINGS.md). Post-fix expectations; flip live per
 * milestone.
 */
import { describe, expect, test } from "bun:test";
import type { PcbNetClass } from "../../../sdks/designer";
import { runDrc } from "../../../shared/drc/drc-engine";
import { buildDrcItems } from "../../../shared/drc/drc-context";
import { checkPendingCopper } from "../../../shared/drc/legality";
import { boardWithRules, projection, trace } from "./helpers/drc-fixtures";

const NET_CLASSES: PcbNetClass[] = [
  {
    id: "default",
    name: "Default",
    traceWidthMm: 0.25,
    clearanceMm: 0.25,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#e5e7eb",
    defaultViaProtection: "tented",
  },
  {
    id: "hv",
    name: "HV",
    traceWidthMm: 0.25,
    clearanceMm: 2,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#f97316",
    defaultViaProtection: "tented",
  },
];

describe("audit B7 — unassigned copper and the net it extends (S13)", () => {
  // Fix: S13 — a post-bridge pass re-resolves the pairs of every null-net item
  // touching exactly ONE named net as that net (contract 06 §4, 07 §9; Astra
  // S8 run 2 #1). Today the null-net trace below extends net A (class `hv`,
  // 2 mm) but is judged against net B with the null-net (default) tier, so
  // the 0.5 mm gap passes in batch and at the live / server gates alike.
  test.todo("B7-1: a null-net trace extending a 2 mm-class net is judged against other nets as that net", () => {
    const board = boardWithRules({
      netClasses: NET_CLASSES,
      perNetClassAssignments: { nA: "hv" },
    });
    const boardCopper = [
      // Net A, class hv (2 mm clearance): the null-net trace starts on it.
      trace("a", "nA", [
        [0, -2],
        [0, 0],
      ]),
      // Net B, default class: 0.5 mm edge gap from the null-net trace below.
      trace("b", "nB", [
        [8, 0.7],
        [10, 0.7],
      ]),
    ];
    const pending = trace("x", null, [
      [0, 0],
      [10, 0],
    ]);
    const netNames = { nA: "A", nB: "B" };

    // Batch: the null trace is an extension of A, so its pair with B resolves
    // at A's tier — 0.5 mm measured against 2 mm required.
    const report = runDrc(
      projection({ board, netNames, traces: [...boardCopper, pending] }),
    );
    const batch = report.violations.filter(
      (v) =>
        v.code === "TRACE_TO_TRACE_CLEARANCE" &&
        v.anchors.some((a) => a.kind === "trace" && a.traceId === "x") &&
        v.anchors.some((a) => a.kind === "trace" && a.traceId === "b"),
    );
    expect(batch).toHaveLength(1);
    expect(batch[0]!.requiredMm).toBe(2);
    expect(batch[0]!.measuredMm).toBeCloseTo(0.5, 9);

    // Live: the same verdict for the same copper as pending (07 §1 clause 1).
    const ctx = buildDrcItems(
      projection({ board, netNames, traces: boardCopper }),
    );
    const live = checkPendingCopper(ctx, { traces: [pending], vias: [] }).filter(
      (v) => v.code === "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(live).toHaveLength(1);
    expect(live[0]!.requiredMm).toBe(2);
    expect(live[0]!.measuredMm).toBe(batch[0]!.measuredMm);
  });
});
