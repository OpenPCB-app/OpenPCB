/**
 * The copper connectivity graph (docs/pcb-hardening/01-connectivity-contract.md
 * §1, §3, §6). Physical overlap only: same net, shared copper layer, copper
 * within CONNECT_EPS_MM. No net-name special case, no cross-layer contact
 * without a via, no bounding-box stand-in for a pad ring.
 *
 * This file pins determinism, an all-pairs equivalence check on the bounds
 * sweep, and a wall-clock budget that would fail if the sweep degraded to
 * O(n²).
 */
import { describe, expect, test } from "bun:test";
import { computeConnectivity } from "../../../shared/pcb-connectivity";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type { PcbPlacedPart, PcbTrace } from "../../../sdks/designer";
import { codes, pad, placement, projection, trace } from "./helpers/drc-fixtures";
import {
  bruteForce,
  buildItems,
  mulberry32,
  randomBoard,
  serialize,
} from "./helpers/pcb-connectivity-fixtures";

describe("determinism and the bounds sweep", () => {
  test("input order never changes the result, component ids included", () => {
    const items = randomBoard(1337);
    const base = serialize(computeConnectivity(items));
    expect(serialize(computeConnectivity([...items].reverse()))).toBe(base);
    const rnd = mulberry32(7);
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    expect(serialize(computeConnectivity(shuffled))).toBe(base);
  });

  test("the per-layer sweep agrees with an all-pairs reference", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const items = randomBoard(seed);
      const result = computeConnectivity(items);
      // Guard the fixture: a degenerate board (no unions, no contacts) would
      // make the equivalence assertion below pass vacuously.
      expect(items.length).toBeGreaterThanOrEqual(55);
      expect(result.components.some((c) => c.itemKeys.length > 1)).toBe(true);
      expect(
        [...result.endpointContacts.values()].some((c) => c[0].size + c[1].size > 0),
      ).toBe(true);
      expect(serialize(result)).toBe(serialize(bruteForce(items)));
    }
  });

  test("300 circular pads + 300 traces stay inside the wall-clock budget", () => {
    const placements: PcbPlacedPart[] = [];
    const padNetIds = new Map<string, string>();
    const traces: PcbTrace[] = [];
    for (let i = 0; i < 300; i += 1) {
      const x = (i % 20) * 2;
      const y = Math.floor(i / 20) * 2;
      const id = `U${i}`;
      placements.push(
        placement(id, {
          positionMm: { x, y },
          pads: [pad("1", { x: 0, y: 0 }, 1, 1, { shape: "circle" })],
        }),
      );
      padNetIds.set(`${id}|1`, "gnd");
      traces.push(trace(`t${i}`, "gnd", [[x, y], [x + 2, y]], { widthMm: 0.25 }));
    }
    const items = buildItems({ placements, padNetIds, traces });
    expect(items).toHaveLength(600);
    const started = performance.now();
    const result = computeConnectivity(items);
    const elapsed = performance.now() - started;
    // One component per grid row: each row's trace chain joins its 20 pads.
    expect(result.components).toHaveLength(15);
    expect(elapsed).toBeLessThan(1000);
  });
});

/**
 * An unplated hole has no barrel: its two copper rings are mechanical and can
 * never be one node (manufacturability contract 10 §2.4). Astra run 1 #2: the
 * previous single-item model let the ratsnest's logical-pin union merge them
 * and hide a genuine open through a hole that conducts nothing.
 */
describe("unplated pads never conduct between faces (contract 10 §2.4)", () => {
  /** One `*.Cu` ring pad on `n1` at the origin. */
  const ringPad = (plated: boolean) =>
    pad("1", { x: 0, y: 0 }, 4, 4, {
      shape: "circle",
      drillDiameterMm: 3.2,
      layer: "*.Cu",
      ...(plated ? {} : { plated: false }),
    });

  const faceTraces: PcbTrace[] = [
    trace("t_front", "n1", [
      [0, 0],
      [8, 0],
    ]),
    trace("t_back", "n1", [
      [0, 0],
      [-8, 0],
    ], { layer: "B.Cu" }),
  ];

  const componentsOf = (plated: boolean) =>
    computeConnectivity(
      buildItems({
        placements: [placement("U1", { pads: [ringPad(plated)] })],
        traces: faceTraces,
        padNetIds: new Map([["U1|1", "n1"]]),
      }),
    );

  test("a front trace and a back trace on ONE unplated ring are two components", () => {
    const result = componentsOf(false);
    const front = result.componentOf.get("trace:t_front");
    const back = result.componentOf.get("trace:t_back");
    expect(front).toBeDefined();
    expect(back).toBeDefined();
    expect(front).not.toBe(back);
  });

  test("the SAME pad plated joins them — the barrel is the connection", () => {
    const result = componentsOf(true);
    expect(result.componentOf.get("trace:t_front")).toBe(
      result.componentOf.get("trace:t_back"),
    );
  });

  /**
   * Two pins of `n1`: the ring pad, and a B.Cu SMD pad routed to it on B.Cu.
   * Plated, the barrel closes the net. Unplated, the pin's per-pad item key
   * matches no kernel item at all, so its component is synthetic and the
   * airwire is permanent — which is why `NPTH_PAD_NET` names the cause.
   */
  const twoPin = (plated: boolean) =>
    projection({
      placements: [
        placement("U1", { pads: [ringPad(plated)] }),
        placement("U2", {
          positionMm: { x: 20, y: 0 },
          pads: [pad("1", { x: 0, y: 0 }, 1, 1, { layer: "B.Cu" })],
        }),
      ],
      traces: [
        trace("t_back", "n1", [
          [0, 0],
          [20, 0],
        ], { layer: "B.Cu" }),
      ],
      padNets: { "U1|1": "n1", "U2|1": "n1" },
      netNames: { n1: "N1" },
    });

  test("a net on an unplated pad is a permanent airwire, and is named", () => {
    const npth = codes(runDrc(twoPin(false)));
    expect(npth).toContain("UNCONNECTED_NET");
    expect(npth).toContain("NPTH_PAD_NET");
    // The identical board with a PLATED wall routes and reports neither.
    const plated = codes(runDrc(twoPin(true)));
    expect(plated).not.toContain("UNCONNECTED_NET");
    expect(plated).not.toContain("NPTH_PAD_NET");
  });

  test("an UNNUMBERED unplated pad (no padNets entry) reports neither", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("U1", {
            pads: [
              pad("", { x: 0, y: 0 }, 4, 4, {
                shape: "circle",
                drillDiameterMm: 3.2,
                layer: "*.Cu",
                plated: false,
              }),
            ],
          }),
        ],
      }),
    );
    expect(codes(report)).not.toContain("NPTH_PAD_NET");
    expect(codes(report)).not.toContain("UNCONNECTED_NET");
  });
});
