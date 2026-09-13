/**
 * The route / tune HUD length gauges read the SHARED net path model
 * (SI contract 14 §6): `computeNetPathLengths` is the ONE place the frontend
 * turns a projection into routed lengths, and `resolveLengthTarget` is the ONE
 * place a `longest` target is resolved.
 *
 * What is pinned here is exactly what the private polyline sums got wrong: a
 * dangling stub is not routed length, a through via's z traversal IS, a net
 * with no pins has no routed length at all, and the gauge's "longest OTHER
 * member" is the batch helper with an `exclude`.
 */
import { describe, expect, test } from "vitest";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbLengthMatchGroup,
  PcbNetClass,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../sdks";
import type { FootprintRenderSourcePad } from "../../../../shared/rendering/types";
import { resolveLengthTarget } from "../../../../shared/drc/si/length-target";
import { buildRouteHudModel } from "./tools/route-hud-model";
import { buildTuneHudModel } from "./tools/tune-hud-model";
import type { RouteSession } from "./tools/route-tool-state";
import { computeNetPathLengths } from "./use-net-path-lengths";

const MM = 1_000_000;
const THICKNESS_MM = 1.6;

function netClass(id: string): PcbNetClass {
  return {
    id,
    name: id,
    traceWidthMm: 0.2,
    clearanceMm: 0.2,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#d4d4d8",
    defaultViaProtection: "tented",
  };
}

function board(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return {
    outline: {
      kind: "rect",
      widthMm: 100,
      heightMm: 100,
      centerMm: { x: 0, y: 0 },
    },
    activeLayer: "F.Cu",
    visibleLayers: ["F.Cu", "B.Cu"],
    designRules: {
      clearance: {
        traceToTraceMm: 0.2,
        traceToPadMm: 0.2,
        padToPadMm: 0.2,
        traceToViaMm: 0.2,
        viaToViaMm: 0.2,
        copperToBoardEdgeMm: 0.5,
      },
      minimums: {
        traceWidthMm: 0.2,
        drillSizeMm: 0.4,
        annularRingMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
      },
    },
    netClasses: [netClass("default")],
    perNetClassAssignments: {},
    tracePresets: [0.2],
    fabricator: "custom",
    layerCount: 2,
    displayMode: "normal",
    boardThicknessMm: THICKNESS_MM,
    solderMaskExpansionMm: 0.075,
    solderPasteExpansionMm: -0.05,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * A circle pin offset from `at` by `dir · r`. With a unit `dir` its copper
 * reaches EXACTLY `at`: the trace centreline touches the pad boundary and
 * never enters it, so the pin attaches without clipping any length off the
 * trace it terminates. With `dir = (0, 0)` the pad sits ON the point and the
 * centreline runs `r` mm INSIDE it, which the path model clips (contract §2.2).
 */
function pin(
  id: string,
  at: PcbPointMm,
  dir: PcbPointMm,
  opts: { drillDiameterMm?: number; diameterMm?: number } = {},
): PcbPlacedPart {
  const diameterMm = opts.diameterMm ?? 1;
  const pad: FootprintRenderSourcePad = {
    id: "pad-1",
    number: "1",
    shape: "circle",
    centerMm: { x: 0, y: 0 },
    widthMm: diameterMm,
    heightMm: diameterMm,
    rotationDeg: 0,
    ...(opts.drillDiameterMm !== undefined
      ? { drillDiameterMm: opts.drillDiameterMm }
      : {}),
  };
  return {
    id,
    partId: id,
    componentId: "c",
    reference: id,
    positionMm: {
      x: at.x + dir.x * (diameterMm / 2),
      y: at.y + dir.y * (diameterMm / 2),
    },
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: [pad],
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
  };
}

function trace(
  id: string,
  netId: string,
  pts: Array<[number, number]>,
  opts: { layer?: PcbTrace["layer"] } = {},
): PcbTrace {
  return {
    id,
    netId,
    netClassId: "default",
    layer: opts.layer ?? "F.Cu",
    widthMm: 0.2,
    pointsNm: pts.map(([x, y]) => ({
      x: Math.round(x * MM),
      y: Math.round(y * MM),
    })),
    segmentMode: "manhattan-90",
  };
}

function via(id: string, netId: string, center: PcbPointMm): PcbVia {
  return {
    id,
    netId,
    netClassId: "default",
    centerMm: center,
    diameterMm: 0.8,
    drillMm: 0.4,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    provenance: "route",
  };
}

function projection(input: {
  placements?: PcbPlacedPart[];
  padNets?: Record<string, string>;
  traces?: PcbTrace[];
  vias?: PcbVia[];
  netNames?: Record<string, string>;
  lengthMatchGroups?: PcbLengthMatchGroup[];
}): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 1,
    board: board(
      input.lengthMatchGroups
        ? { lengthMatchGroups: input.lengthMatchGroups }
        : {},
    ),
    placements: input.placements ?? [],
    traces: input.traces ?? [],
    vias: input.vias ?? [],
    freeHoles: [],
    freePads: [],
    overlayTexts: [],
    overlayShapes: [],
    zones: [],
    keepouts: [],
    ratsnest: [],
    netNames: input.netNames ?? {},
    padNets: input.padNets ?? {},
    warnings: [],
  };
}

describe("computeNetPathLengths", () => {
  test("two pins with a T-stub: the stub is not routed length", () => {
    const p = projection({
      placements: [
        pin("U1", { x: 0, y: 0 }, { x: -1, y: 0 }),
        pin("U2", { x: 10, y: 0 }, { x: 1, y: 0 }),
      ],
      padNets: { "U1|1": "net-a", "U2|1": "net-a" },
      traces: [
        trace("t-main", "net-a", [
          [0, 0],
          [10, 0],
        ]),
        // Dangling branch off the middle of the run: copper, but on no route
        // between the two pins, so it is `branchLengthMm` and never summed.
        trace("t-stub", "net-a", [
          [5, 0],
          [5, 3],
        ]),
      ],
      netNames: { "net-a": "A" },
    });
    const lengths = computeNetPathLengths(p, ["net-a"]);
    expect(lengths.get("net-a")).toBeCloseTo(10, 6);
  });

  test("a through via adds the board thickness and clips its barrel copper", () => {
    const p = projection({
      placements: [
        pin("U1", { x: 0, y: 5 }, { x: -1, y: 0 }),
        // Through-hole pin: its copper exists on B.Cu too, so it terminates
        // the far side of the via transition.
        pin("U2", { x: 8, y: 5 }, { x: 1, y: 0 }, { drillDiameterMm: 0.5 }),
      ],
      padNets: { "U1|1": "net-b", "U2|1": "net-b" },
      traces: [
        trace("t-f", "net-b", [
          [0, 5],
          [4, 5],
        ]),
        trace(
          "t-b",
          "net-b",
          [
            [4, 5],
            [8, 5],
          ],
          { layer: "B.Cu" },
        ),
      ],
      vias: [via("v1", "net-b", { x: 4, y: 5 })],
      netNames: { "net-b": "B" },
    });
    const lengths = computeNetPathLengths(p, ["net-b"]);
    // 4 + 4 mm of copper, less the 0.4 mm inside the via's barrel disc on each
    // layer (§10), plus the ONE defined barrel length: the board thickness.
    expect(lengths.get("net-b")).toBeCloseTo(7.2 + THICKNESS_MM, 6);
  });

  test("a net with no pins has no routed length at all", () => {
    const p = projection({
      traces: [
        trace("t-c", "net-c", [
          [0, 20],
          [6, 20],
        ]),
      ],
      netNames: { "net-c": "C" },
    });
    expect(computeNetPathLengths(p, ["net-c"]).has("net-c")).toBe(false);
    // An unknown net id is simply absent, never zero.
    expect(computeNetPathLengths(p, ["net-zzz"]).has("net-zzz")).toBe(false);
  });

  test("a `longest` target with `exclude` is the longest OTHER member", () => {
    const group: PcbLengthMatchGroup = {
      id: "g1",
      name: "DDR",
      netIds: ["net-a", "net-b", "net-c"],
      target: { kind: "longest" },
      toleranceMm: 0.5,
    };
    const lengths = new Map([
      ["net-a", 10],
      ["net-b", 14],
    ]);
    // `net-b` is the longest, so measuring IT compares against `net-a`.
    expect(resolveLengthTarget(group, lengths, { exclude: "net-b" })).toEqual({
      targetMm: 10,
    });
    expect(resolveLengthTarget(group, lengths, { exclude: "net-a" })).toEqual({
      targetMm: 14,
    });
    // `net-c` has no defined path: it is absent from the map, so it can
    // neither set the target nor be judged.
    expect(resolveLengthTarget(group, lengths, { exclude: "net-c" })).toEqual({
      targetMm: 14,
    });
  });
});

describe("the tune gauge total", () => {
  /**
   * The commonest topology there is: ONE trace between two pads it runs into.
   * The gauge must read the batch check's number, so `netOtherMm` has to carry
   * the NEGATIVE remainder of the clipped pad copper — a clamp at 0 would put
   * the raw 20 mm polyline on screen while `NET_LENGTH_OUT_OF_RANGE` judges
   * 19.4 and flip the verdict from "short" to "long".
   */
  test("a single trace between two pads reads the batch path length", () => {
    const p = projection({
      placements: [
        // Ø0.6 pads centred ON the trace endpoints: the centreline runs
        // 0.3 mm inside each, and both those runs are clipped (§2.2).
        pin("U1", { x: 0, y: 0 }, { x: 0, y: 0 }, { diameterMm: 0.6 }),
        pin("U2", { x: 20, y: 0 }, { x: 0, y: 0 }, { diameterMm: 0.6 }),
      ],
      padNets: { "U1|1": "net-t", "U2|1": "net-t" },
      traces: [
        trace("t-only", "net-t", [
          [0, 0],
          [20, 0],
        ]),
      ],
      netNames: { "net-t": "T" },
    });
    const pathMm = computeNetPathLengths(p, ["net-t"]).get("net-t");
    expect(pathMm).toBeCloseTo(19.4, 6);

    // What PcbCanvas hands the HUD: the raw baseline polyline and the path's
    // remainder after it.
    const baselineMm = 20;
    const netOtherMm = pathMm! - baselineMm;
    expect(netOtherMm).toBeCloseTo(-0.6, 6);

    const model = buildTuneHudModel({
      session: {
        traceId: "t-only",
        baselinePointsNm: [
          { x: 0, y: 0 },
          { x: 20 * MM, y: 0 },
        ],
        spanStartNm: 0,
        spanEndNm: 20 * MM,
        sweeping: false,
        amplitudeNm: 0.5 * MM,
        spacingNm: 0.5 * MM,
      },
      netName: "T",
      group: { name: "DDR", targetMm: 19.4, toleranceMm: 0.1 },
      netOtherMm,
      baselineMm,
      proposalExtraMm: 0,
      meanderStatus: null,
      pathDefined: true,
    });
    // No proposal yet, so the gauge is the path length exactly — not 20.
    expect(model.currentMm).toBeCloseTo(pathMm!, 6);
    expect(model.deltaMm).toBeCloseTo(0, 6);
    expect(model.band).toBe("ok");
    expect(model.pathDefined).toBe(true);
  });
});

/** A session with no committed runs — only the ghost under the cursor. */
function session(): RouteSession {
  return {
    netId: "net-a",
    netClassId: "default",
    layer: "F.Cu",
    widthMm: 0.2,
    widthSource: "netclass",
    segmentMode: "manhattan-45",
    posture: "hv",
    startNm: { x: 0, y: 0 },
    boundaries: [],
  };
}

describe("the route gauge total", () => {
  const ghostNm = [
    { x: 0, y: 0 },
    { x: 4 * MM, y: 0 },
  ];

  test("a defined path plus the in-flight polyline", () => {
    const model = buildRouteHudModel({
      session: session(),
      previewPathNm: ghostNm,
      netName: "A",
      netClass: null,
      drcConflictCount: 0,
      lengthTarget: {
        groupName: "DDR",
        targetMm: 15,
        toleranceMm: 0.5,
        committedMm: 10,
        pathDefined: true,
      },
    });
    expect(model.lengthMm).toBeCloseTo(4, 6);
    expect(model.lengthTarget?.totalMm).toBeCloseTo(14, 6);
    expect(model.lengthTarget?.pathDefined).toBe(true);
  });

  test("an undefined path still shows the gauge, flagged approximate", () => {
    const model = buildRouteHudModel({
      session: session(),
      previewPathNm: ghostNm,
      netName: "A",
      netClass: null,
      drcConflictCount: 0,
      lengthTarget: {
        groupName: "DDR",
        targetMm: 15,
        toleranceMm: 0.5,
        // Mid-route the net is OPEN: the fallback is the committed polyline sum.
        committedMm: 9.5,
        pathDefined: false,
      },
    });
    expect(model.lengthTarget?.totalMm).toBeCloseTo(13.5, 6);
    expect(model.lengthTarget?.pathDefined).toBe(false);
  });
});
