/**
 * `TRACK_DANGLING` / `VIA_DANGLING` derived from the shared connectivity kernel
 * (docs/pcb-hardening/01-connectivity-contract.md §4). These cases pin the
 * behaviours the old private predicate in `checks/dangling.ts` got wrong:
 * end caps instead of bare centreline points, real pour ISLANDS instead of
 * "any same-net pour on this layer", the fail-safe layer policy for
 * layer-invalid copper, and the asymmetric null-net contact rule.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { computeRatsnest } from "../../../modules/designer/backend/pcb/ratsnest";
import type {
  DesignerPcbProjection,
  DrcReport,
  PcbBoardSettings,
} from "../../../sdks/designer";
import { boardZoneRow } from "./helpers/pcb-zone-fixtures";
import {
  board,
  boardWithRules,
  codes,
  freePad,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

function board100(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return {
    ...board(),
    outline: {
      kind: "rect",
      widthMm: 100,
      heightMm: 100,
      centerMm: { x: 0, y: 0 },
    },
    ...overrides,
  };
}

/** Fill the projection's ratsnest through the real kernel (UNCONNECTED_NET). */
function withRatsnest(p: DesignerPcbProjection): DesignerPcbProjection {
  return {
    ...p,
    ratsnest: computeRatsnest({
      layerCount: p.board.layerCount,
      netNames: new Map(Object.entries(p.netNames)),
      netClasses: p.board.netClasses,
      perNetClassAssignments: p.board.perNetClassAssignments,
      placements: p.placements,
      padNetIds: new Map(Object.entries(p.padNets ?? {})),
      freePads: p.freePads,
      traces: p.traces,
      vias: p.vias,
    }),
  };
}

/** Trace ids reported as dangling. */
function danglingTraces(report: DrcReport): string[] {
  return report.violations
    .filter((v) => v.code === "TRACK_DANGLING")
    .flatMap((v) =>
      v.anchors.flatMap((a) => (a.kind === "trace" ? [a.traceId] : [])),
    )
    .sort();
}

/** The board a GND-style board-wide pour needs (the pour itself is a zone row). */
function pouredBoard(): PcbBoardSettings {
  const base = boardWithRules({
    // A wide void so the different-net clearance halo below is unambiguous.
    clearance: { traceToPadMm: 1, padToPadMm: 1, traceToTraceMm: 1 },
  });
  return {
    ...base,
    outline: {
      kind: "rect",
      widthMm: 100,
      heightMm: 100,
      centerMm: { x: 0, y: 0 },
    },
  };
}

describe("dangling — fail-safe layer policy", () => {
  test("In1.Cu pad on a 2-layer board is isolated for connectivity", () => {
    // The pad declares a layer that is not on the stackup. Under the CLAMP
    // policy DRC still collides it on every valid layer (so it cannot mask a
    // short), but the connectivity graph must treat it as occupying no layer:
    // the trace ending on it links nothing, leaving the net unrouted.
    const report = runDrc(
      withRatsnest(
        projection({
          board: board100({ layerCount: 2 }),
          netNames: { n1: "SIG" },
          placements: [
            placement("A", {
              positionMm: { x: 0, y: 0 },
              pads: [pad("1", { x: 0, y: 0 }, 1, 1, { layer: "In1.Cu" })],
            }),
            placement("B", {
              positionMm: { x: 10, y: 0 },
              pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
            }),
          ],
          padNets: { "A|1": "n1", "B|1": "n1" },
          traces: [trace("t", "n1", [[0, 0], [10, 0]])],
        }),
      ),
    );
    expect(codes(report)).toContain("PAD_LAYER_MISMATCH");
    expect(codes(report)).toContain("UNCONNECTED_NET");
  });
});

describe("dangling — pour islands, not whole layers", () => {
  test("end cap inside a same-net pour island → not dangling", () => {
    const report = runDrc(
      projection({
        board: pouredBoard(),
        zones: [boardZoneRow("F.Cu", "n1")],
        netNames: { n1: "GND" },
        placements: [
          placement("A", {
            positionMm: { x: 40, y: 40 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "A|1": "n1" },
        traces: [trace("t", "n1", [[20, 20], [30, 20]])],
      }),
    );
    expect(danglingTraces(report)).not.toContain("t");
  });

  test("end cap inside a different-net clearance void → dangling", () => {
    // Same poured board, but the trace end sits in the void the pour leaves
    // around a different-net pad, so the island does not reach it. The old
    // whole-layer `pourLayerMap` shortcut called this connected.
    const report = runDrc(
      projection({
        board: pouredBoard(),
        zones: [boardZoneRow("F.Cu", "n1")],
        netNames: { n1: "GND", n2: "SIG" },
        placements: [
          placement("A", {
            positionMm: { x: 40, y: 40 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
          placement("P", {
            positionMm: { x: 30, y: 20 },
            pads: [pad("1", { x: 0, y: 0 }, 2, 2)],
          }),
        ],
        padNets: { "A|1": "n1", "P|1": "n2" },
        traces: [trace("t", "n1", [[25, 21.5], [30, 21.5]])],
      }),
    );
    expect(danglingTraces(report)).toContain("t");
    // The FREE end (inside the void) is the reported one; the other end sits in
    // the island and connects. Without the different-net pad there is no report.
    expect(
      report.violations.find((v) => v.code === "TRACK_DANGLING")?.locationMm,
    ).toEqual({ x: 30, y: 21.5 });
  });
});

describe("dangling — vias", () => {
  test("via spanning an off-stackup layer → VIA_DANGLING + VIA_LAYER_SPAN", () => {
    const report = runDrc(
      projection({
        board: board100({ layerCount: 2 }),
        netNames: { n1: "SIG" },
        vias: [
          via("v", {
            netId: "n1",
            center: { x: 5, y: 0 },
            fromLayer: "F.Cu",
            toLayer: "In1.Cu",
          }),
        ],
      }),
    );
    expect(codes(report)).toContain("VIA_DANGLING");
    expect(codes(report)).toContain("VIA_LAYER_SPAN");
  });

  test("via joining an F.Cu trace and a B.Cu pad → not dangling", () => {
    const report = runDrc(
      projection({
        board: board100(),
        netNames: { n1: "SIG" },
        freePads: [
          freePad("fp", {
            layer: "B.Cu",
            netId: "n1",
            center: { x: 5, y: 0 },
            widthMm: 1,
            heightMm: 1,
          }),
        ],
        traces: [trace("t", "n1", [[0, 0], [5, 0]])],
        vias: [via("v", { netId: "n1", center: { x: 5, y: 0 } })],
      }),
    );
    expect(codes(report)).not.toContain("VIA_DANGLING");
  });
});

describe("dangling — end caps, not centreline points", () => {
  test("end cap 5 µm short of a sibling's centreline → not dangling", () => {
    // 0.25 mm wide traces: the caps overlap by 0.245 mm of copper, but the old
    // point-to-centreline test (1 µm tolerance) called this a stub.
    const report = runDrc(
      projection({
        board: board100(),
        netNames: { n1: "SIG" },
        placements: [
          placement("A", {
            positionMm: { x: 0, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "A|1": "n1" },
        traces: [
          trace("a", "n1", [[10, -5], [10, 5]], { widthMm: 0.25 }),
          trace("b", "n1", [[0, 0], [9.995, 0]], { widthMm: 0.25 }),
        ],
      }),
    );
    expect(danglingTraces(report)).not.toContain("b");
  });
});

describe("dangling — null-net contact is asymmetric", () => {
  test("null-net trace resting on named-net pads → not dangling", () => {
    const report = runDrc(
      projection({
        board: board100(),
        netNames: { n1: "SIG" },
        placements: [
          placement("A", {
            positionMm: { x: 0, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
          placement("B", {
            positionMm: { x: 10, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "A|1": "n1", "B|1": "n1" },
        traces: [trace("nt", null, [[0, 0], [10, 0]])],
      }),
    );
    expect(danglingTraces(report)).not.toContain("nt");
  });

  test("named-net trace ending on null-net copper → still dangling", () => {
    const report = runDrc(
      projection({
        board: board100(),
        netNames: { n1: "SIG" },
        placements: [
          placement("A", {
            positionMm: { x: 0, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "A|1": "n1" },
        traces: [
          trace("t", "n1", [[0, 0], [10, 0]]),
          trace("nt", null, [[10, -5], [10, 5]]),
        ],
      }),
    );
    expect(danglingTraces(report)).toContain("t");
  });
});
