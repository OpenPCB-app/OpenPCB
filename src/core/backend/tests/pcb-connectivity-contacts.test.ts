/**
 * The copper connectivity graph (docs/pcb-hardening/01-connectivity-contract.md
 * §1, §3, §6). Physical overlap only: same net, shared copper layer, copper
 * within CONNECT_EPS_MM. No net-name special case, no cross-layer contact
 * without a via, no bounding-box stand-in for a pad ring.
 *
 * This file pins contact records — end caps and via span layers, which
 * components alone cannot answer (a trace crossing another mid-body is still
 * a stub) — plus degenerate copper, duplicate pad numbers, and the epsilon
 * constant.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCopperRecords,
  computeConnectivity,
  padItemKey,
  pourCopperItem,
  toCopperItems,
  traceItemKey,
  viaItemKey,
  type CopperPadAnchor,
} from "../../../shared/pcb-connectivity";
import { CONNECT_EPS_MM } from "../../../shared/pcb-geometry/tolerance";
import { pad, placement, trace, via } from "./helpers/drc-fixtures";
import {
  buildItems,
  byKey,
  componentKeys,
  input,
  padAnchorOf,
  padPart,
  serialize,
} from "./helpers/pcb-connectivity-fixtures";

describe("contact records", () => {
  test("an end cap 5 µm short of a sibling centreline connects AND registers a contact", () => {
    const items = buildItems({
      traces: [
        trace("bus", "n1", [[0, 0], [10, 0]], { widthMm: 0.25 }),
        trace("stub", "n1", [[5, 2], [5, 0.005]], { widthMm: 0.25 }),
      ],
    });
    const result = computeConnectivity(items);
    expect(componentKeys(result)).toEqual([
      [traceItemKey("bus"), traceItemKey("stub")],
    ]);
    expect([...result.endpointContacts.get(traceItemKey("stub"))![1]]).toEqual([
      traceItemKey("bus"),
    ]);
    expect([...result.endpointContacts.get(traceItemKey("stub"))![0]]).toEqual([]);
  });

  test("a trace crossing another mid-body shares its component but keeps both ends dangling", () => {
    const items = buildItems({
      traces: [
        trace("bus", "n1", [[0, 0], [10, 0]], { widthMm: 0.25 }),
        trace("cross", "n1", [[5, -3], [5, 3]], { widthMm: 0.25 }),
      ],
    });
    const result = computeConnectivity(items);
    expect(result.components).toHaveLength(1);
    const caps = result.endpointContacts.get(traceItemKey("cross"))!;
    expect([...caps[0]]).toEqual([]);
    expect([...caps[1]]).toEqual([]);
  });

  test("a closed loop is not a stub: both end caps contact the trace's own body", () => {
    const result = computeConnectivity(
      buildItems({
        traces: [
          trace("loop", "n1", [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], {
            widthMm: 0.2,
          }),
        ],
      }),
    );
    const caps = result.endpointContacts.get(traceItemKey("loop"))!;
    expect([...caps[0]]).toEqual([traceItemKey("loop")]);
    expect([...caps[1]]).toEqual([traceItemKey("loop")]);
  });

  test("a straight two-point trace never self-contacts (every segment is incident)", () => {
    const result = computeConnectivity(
      buildItems({ traces: [trace("t1", "n1", [[0, 0], [5, 0]], { widthMm: 0.2 })] }),
    );
    const caps = result.endpointContacts.get(traceItemKey("t1"))!;
    expect([...caps[0]]).toEqual([]);
    expect([...caps[1]]).toEqual([]);
  });

  test("a short first jog and a Manhattan corner are still stubs, not self-contacts", () => {
    // Both were rescued by a pure-proximity rule: the copper of the next
    // segment sits within 2·hw of the endpoint, but it is only 0.2 / 0.15 mm
    // away ALONG the conductor, so there is no fold-back.
    const result = computeConnectivity(
      buildItems({
        traces: [
          trace("jog", "n1", [[0, 0], [0.2, 0], [5, 0]], { widthMm: 0.25 }),
          trace("corner", "n1", [[10, 0], [10.15, 0], [10.15, 5]], {
            widthMm: 0.25,
          }),
        ],
      }),
    );
    for (const id of ["jog", "corner"]) {
      const caps = result.endpointContacts.get(traceItemKey(id))!;
      expect([...caps[0]]).toEqual([]);
      expect([...caps[1]]).toEqual([]);
    }
  });

  test("a U-turn is found by the FARTHEST reachable point, not the nearest one", () => {
    // Astra 7. width 0.2 → reach 0.2. On the return leg the NEAREST point to
    // the start cap is (0, 0.1): d = 0.1 but only s = 0.28 of conductor away,
    // so s − d = 0.18 ≤ 0.2 and a nearest-point rule calls this a stub. The
    // farthest point still within reach, (−0.173, 0.1), has d = 0.2 and
    // s = 0.453 → s − d = 0.253 > 0.2. It is a fold-back.
    const path: Array<[number, number]> = [
      [0, 0],
      [0.09, 0],
      [0.09, 0.1],
      [-0.5, 0.1],
    ];
    const result = computeConnectivity(
      buildItems({ traces: [trace("u", "n1", path, { widthMm: 0.2 })] }),
    );
    expect([
      ...result.endpointContacts.get(traceItemKey("u"))![0],
    ]).toEqual([traceItemKey("u")]);

    // A collinear waypoint splits the return leg in two; the verdict is a
    // property of the copper, so it must not depend on the vertex count.
    const split: Array<[number, number]> = [
      [0, 0],
      [0.09, 0],
      [0.09, 0.1],
      [-0.15, 0.1],
      [-0.5, 0.1],
    ];
    const resplit = computeConnectivity(
      buildItems({ traces: [trace("u", "n1", split, { widthMm: 0.2 })] }),
    );
    expect([
      ...resplit.endpointContacts.get(traceItemKey("u"))![0],
    ]).toEqual([traceItemKey("u")]);
  });

  test("a hairpin returning within reach after a long run self-contacts at both ends", () => {
    // width 0.4 → reach 2·hw = 0.4. The return leg's closest point to the start
    // cap is (0.05, 0.2): d = 0.206 ≤ 0.4, and s − d ≈ 6.15 − 0.21 ≫ 0.4.
    const result = computeConnectivity(
      buildItems({
        traces: [
          trace("hairpin", "n1", [[0, 0], [3, 0], [3, 0.2], [0.05, 0.2]], {
            widthMm: 0.4,
          }),
        ],
      }),
    );
    const caps = result.endpointContacts.get(traceItemKey("hairpin"))!;
    expect([...caps[0]]).toEqual([traceItemKey("hairpin")]);
    expect([...caps[1]]).toEqual([traceItemKey("hairpin")]);
  });

  test("the same hairpin at 0.2 mm wide is out of reach at the start cap", () => {
    // reach is now 0.2 < d = 0.206, so the threshold is doing real work.
    const result = computeConnectivity(
      buildItems({
        traces: [
          trace("hairpin", "n1", [[0, 0], [3, 0], [3, 0.2], [0.05, 0.2]], {
            widthMm: 0.2,
          }),
        ],
      }),
    );
    const caps = result.endpointContacts.get(traceItemKey("hairpin"))!;
    expect([...caps[0]]).toEqual([]);
    expect([...caps[1]]).toEqual([traceItemKey("hairpin")]);
  });

  test("via layer contacts are recorded per span layer", () => {
    const items = buildItems({
      layerCount: 4,
      traces: [
        trace("f", "n1", [[0, 0], [10, 0]]),
        trace("in2", "n1", [[0, 0], [10, 0]], { layer: "In2.Cu" }),
      ],
      vias: [via("v1", { netId: "n1", center: { x: 5, y: 0 } })],
    });
    const result = computeConnectivity(items);
    const perLayer = result.viaLayerContacts.get(viaItemKey("v1"))!;
    expect([...perLayer.keys()]).toEqual(["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]);
    expect([...perLayer.get("F.Cu")!]).toEqual([traceItemKey("f")]);
    expect([...perLayer.get("In1.Cu")!]).toEqual([]);
    expect([...perLayer.get("In2.Cu")!]).toEqual([traceItemKey("in2")]);
    expect([...perLayer.get("B.Cu")!]).toEqual([]);
  });

  test("contact is asymmetric: unassigned copper contacts anything, named copper only its own net", () => {
    const items = buildItems({
      traces: [
        trace("free", null, [[0, 0], [5, 0]]),
        trace("named", "n1", [[5, 0], [10, 0]]),
      ],
    });
    const result = computeConnectivity(items);
    expect(result.componentOf.has(traceItemKey("free"))).toBe(false);
    expect(componentKeys(result)).toEqual([[traceItemKey("named")]]);
    // The unassigned trace's end cap is in contact with the named copper …
    expect([...result.endpointContacts.get(traceItemKey("free"))![1]]).toEqual([
      traceItemKey("named"),
    ]);
    // … but null-net copper never rescues the named trace from being a stub.
    expect([...result.endpointContacts.get(traceItemKey("named"))![0]]).toEqual([]);
  });
});

describe("degenerate copper is not copper", () => {
  test("a zero-width trace keeps its record but yields no item", () => {
    const records = buildCopperRecords(
      input({ traces: [trace("t1", "n1", [[0, 0], [5, 0]], { widthMm: 0 })] }),
    );
    expect(records.traces).toHaveLength(1);
    expect(toCopperItems(records)).toEqual([]);
  });

  test("a zero-radius via keeps its record but yields no item", () => {
    const records = buildCopperRecords(
      input({ vias: [via("v1", { netId: "n1", diameterMm: 0 })] }),
    );
    expect(records.vias).toHaveLength(1);
    expect(toCopperItems(records)).toEqual([]);
  });

  test("a zero-area pad ring keeps its record but yields no item", () => {
    const records = buildCopperRecords(
      input({
        placements: [
          placement("U1", { pads: [pad("1", { x: 0, y: 0 }, 0, 1)] }),
        ],
        padNetIds: new Map([["U1|1", "n1"]]),
      }),
    );
    expect(records.pads).toHaveLength(1);
    expect(toCopperItems(records)).toEqual([]);
  });

  test("degenerate copper cannot bridge two components", () => {
    const result = computeConnectivity(
      buildItems({
        traces: [
          trace("a", "n1", [[0, 0], [4, 0]]),
          trace("bridge", "n1", [[4, 0], [6, 0]], { widthMm: 0 }),
          trace("b", "n1", [[6, 0], [10, 0]]),
        ],
      }),
    );
    expect(componentKeys(result)).toEqual([
      [traceItemKey("a")],
      [traceItemKey("b")],
    ]);
  });
});

describe("pad keys are injective", () => {
  test("a pad literally numbered \"1#2\" cannot be confused with pin \"1\" shape 2", () => {
    expect(padItemKey("U1", "1", 1)).not.toBe(padItemKey("U1", "1#2", 0));
    expect(padItemKey("U1|1", "2", 0)).not.toBe(padItemKey("U1", "1|2", 0));
  });

  test("pour membership lands on the pad the fill kernel named, not a namesake", () => {
    // Preview order is "1", "1", "1#2". Under a concatenated key the SECOND
    // shape of pin "1" would answer to `pad:U1|1#2` and steal the island that
    // belongs to pin "1#2".
    const items = buildItems({
      placements: [
        placement("U1", {
          pads: [
            pad("1", { x: 0, y: 0 }, 1, 1),
            pad("1", { x: 4, y: 0 }, 1, 1),
            pad("1#2", { x: 8, y: 0 }, 1, 1),
          ],
        }),
      ],
      padNetIds: new Map([["U1|1", "gnd"], ["U1|1#2", "gnd"]]),
    });
    const island = pourCopperItem({
      layer: "F.Cu",
      netId: "gnd",
      pourIndex: 0,
      index: 0,
      rings: [[
        { x: 7, y: -1 },
        { x: 9, y: -1 },
        { x: 9, y: 1 },
        { x: 7, y: 1 },
      ]],
      memberKeys: [padItemKey("U1", "1#2", 0)],
    });
    const result = computeConnectivity([...items, island]);
    expect(result.componentOf.get(padItemKey("U1", "1#2", 0))).toBe(
      result.componentOf.get("pour:F.Cu:gnd:0:0"),
    );
    expect(result.componentOf.get(padItemKey("U1", "1", 1))).not.toBe(
      result.componentOf.get("pour:F.Cu:gnd:0:0"),
    );
  });
});

describe("duplicate item ids", () => {
  test("a duplicated trace id is renamed deterministically and loses pour membership", () => {
    // Persisted data can carry the same id twice; without a rename the graph's
    // key index would be last-write-wins and the verdict order-dependent.
    const near = trace("t1", "gnd", [[0, 0], [5, 0]]);
    const far = trace("t1", "gnd", [[20, 0], [25, 0]]);
    const island = pourCopperItem({
      layer: "F.Cu",
      netId: "gnd",
      pourIndex: 0,
      index: 0,
      rings: [[
        { x: -1, y: -5 },
        { x: 30, y: -5 },
        { x: 30, y: 5 },
        { x: -1, y: 5 },
      ]],
      memberKeys: [traceItemKey("t1")],
    });

    const forward = computeConnectivity([
      ...buildItems({ traces: [near, far] }),
      island,
    ]);
    const reversed = computeConnectivity([
      ...buildItems({ traces: [far, near] }),
      island,
    ]);
    expect(serialize(reversed)).toBe(serialize(forward));
    // Exactly one of the two claims the pour; the renamed copy is fail-safe.
    expect(componentKeys(forward)).toEqual([
      ["pour:F.Cu:gnd:0:0", traceItemKey("t1")],
      [`${traceItemKey("t1")}#2`],
    ]);
  });
});

describe("one pin, several copper shapes", () => {
  test("duplicate pad numbers get unique item keys and share one anchor", () => {
    const records = buildCopperRecords(
      input({
        placements: [
          placement("U1", {
            pads: [pad("1", { x: 0, y: 0 }, 1, 1), pad("1", { x: 2, y: 0 }, 1, 1)],
          }),
        ],
        padNetIds: new Map([["U1|1", "n1"]]),
        traces: [trace("t1", "n1", [[2, 0], [6, 0]])],
      }),
    );
    expect(records.pads.map((p) => p.occurrence)).toEqual([0, 1]);
    const items = toCopperItems(records);
    expect(items.slice(0, 2).map((i) => i.key)).toEqual([
      padItemKey("U1", "1"),
      padItemKey("U1", "1", 1),
    ]);
    // Both shapes stay one logical pin: same anchor, different key.
    const logical: CopperPadAnchor = {
      kind: "pad",
      placementId: "U1",
      padNumber: "1",
    };
    expect(padAnchorOf(byKey(items, padItemKey("U1", "1")))).toEqual(logical);
    expect(padAnchorOf(byKey(items, padItemKey("U1", "1", 1)))).toEqual(logical);

    const result = computeConnectivity(items);
    expect(componentKeys(result)).toEqual([
      [padItemKey("U1", "1")],
      [padItemKey("U1", "1", 1), traceItemKey("t1")],
    ]);
  });
});

describe("epsilon", () => {
  test("CONNECT_EPS_MM is half the coordinate quantum: abutment connects, 1 nm does not", () => {
    expect(CONNECT_EPS_MM).toBe(5e-7);

    // Exact abutment — two 1 mm pads meeting edge to edge — is one conductor.
    const abutting = computeConnectivity(
      buildItems({
        placements: [padPart("A", 0, 0), padPart("B", 1, 0)],
        padNetIds: new Map([["A|1", "n1"], ["B|1", "n1"]]),
      }),
    );
    expect(abutting.components).toHaveLength(1);

    // The smallest gap the nanometre grid can express is already OPEN.
    const oneNanometre = computeConnectivity(
      buildItems({
        placements: [padPart("A", 0, 0), padPart("B", 1.000001, 0)],
        padNetIds: new Map([["A|1", "n1"], ["B|1", "n1"]]),
      }),
    );
    expect(oneNanometre.components).toHaveLength(2);

    // …as is a designed 1 µm trace-to-trace gap.
    const parted = computeConnectivity(
      buildItems({
        traces: [
          trace("a", "n1", [[0, 0], [5, 0]], { widthMm: 0.2 }),
          trace("b", "n1", [[0, 0.201], [5, 0.201]], { widthMm: 0.2 }),
        ],
      }),
    );
    expect(parted.components).toHaveLength(2);
  });
});
