/**
 * The copper connectivity graph (docs/pcb-hardening/01-connectivity-contract.md
 * §1, §3, §6). Physical overlap only: same net, shared copper layer, copper
 * within CONNECT_EPS_MM. No net-name special case, no cross-layer contact
 * without a via, no bounding-box stand-in for a pad ring.
 *
 * This file pins the touch matrix per pair kind (including exact tangency)
 * and layer semantics (via spans, through-hole pads, layer-invalid items),
 * plus pour-island membership.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCopperRecords,
  computeConnectivity,
  copperTouch,
  freePadItemKey,
  padItemKey,
  pointToIslandDistance,
  pourCopperItem,
  toCopperItems,
  traceItemKey,
  viaItemKey,
  type CopperRecordsInput,
} from "../../../shared/pcb-connectivity";
import type { PcbPlacedPart } from "../../../sdks/designer";
import { freePad, pad, placement, trace, via } from "./helpers/drc-fixtures";
import {
  buildItems,
  byKey,
  componentKeys,
  input,
  padPart,
  square,
} from "./helpers/pcb-connectivity-fixtures";

// --------------------------------------------------------------------------
// 1. Touch matrix
// --------------------------------------------------------------------------

/** A placement carrying one circular pad of `diameterMm` centred at (x, y). */
function padCircle(
  id: string,
  x: number,
  y: number,
  diameterMm: number,
): PcbPlacedPart {
  return placement(id, {
    positionMm: { x, y },
    pads: [
      pad("1", { x: 0, y: 0 }, diameterMm, diameterMm, { shape: "circle" }),
    ],
  });
}

describe("touch matrix — exact tangency touches, a 0.2 mm gap does not", () => {
  const nets = new Map([
    ["A|1", "n1"],
    ["B|1", "n1"],
  ]);

  function pair(parts: Partial<CopperRecordsInput>, a: string, b: string): boolean {
    const items = buildItems({ ...parts, padNetIds: nets });
    return copperTouch(byKey(items, a), byKey(items, b));
  }

  test("pad – pad", () => {
    expect(pair({ placements: [padPart("A", 0, 0), padPart("B", 1, 0)] }, padItemKey("A", "1"), padItemKey("B", "1"))).toBe(true);
    expect(pair({ placements: [padPart("A", 0, 0), padPart("B", 1.2, 0)] }, padItemKey("A", "1"), padItemKey("B", "1"))).toBe(false);
  });

  test("pad – trace", () => {
    const parts = (x0: number) => ({
      placements: [padPart("A", 0, 0)],
      traces: [trace("t1", "n1", [[x0, 0], [3, 0]], { widthMm: 0.2 })],
    });
    expect(pair(parts(0.6), padItemKey("A", "1"), traceItemKey("t1"))).toBe(true);
    expect(pair(parts(0.8), padItemKey("A", "1"), traceItemKey("t1"))).toBe(false);
  });

  test("pad – via", () => {
    const parts = (cx: number) => ({
      placements: [padPart("A", 0, 0)],
      vias: [via("v1", { netId: "n1", center: { x: cx, y: 0 }, diameterMm: 0.8 })],
    });
    expect(pair(parts(0.9), padItemKey("A", "1"), viaItemKey("v1"))).toBe(true);
    expect(pair(parts(1.1), padItemKey("A", "1"), viaItemKey("v1"))).toBe(false);
  });

  test("trace – trace", () => {
    const parts = (y: number) => ({
      traces: [
        trace("t1", "n1", [[0, 0], [5, 0]], { widthMm: 0.2 }),
        trace("t2", "n1", [[0, y], [5, y]], { widthMm: 0.2 }),
      ],
    });
    expect(pair(parts(0.2), traceItemKey("t1"), traceItemKey("t2"))).toBe(true);
    expect(pair(parts(0.4), traceItemKey("t1"), traceItemKey("t2"))).toBe(false);
  });

  test("trace – via", () => {
    const parts = (y: number) => ({
      traces: [trace("t1", "n1", [[0, y], [5, y]], { widthMm: 0.2 })],
      vias: [via("v1", { netId: "n1", center: { x: 2, y: 0 }, diameterMm: 0.8 })],
    });
    expect(pair(parts(0.5), traceItemKey("t1"), viaItemKey("v1"))).toBe(true);
    expect(pair(parts(0.7), traceItemKey("t1"), viaItemKey("v1"))).toBe(false);
  });

  test("via – via", () => {
    const parts = (x: number) => ({
      vias: [
        via("v1", { netId: "n1", center: { x: 0, y: 0 }, diameterMm: 0.8 }),
        via("v2", { netId: "n1", center: { x, y: 0 }, diameterMm: 0.8 }),
      ],
    });
    expect(pair(parts(0.8), viaItemKey("v1"), viaItemKey("v2"))).toBe(true);
    expect(pair(parts(1.0), viaItemKey("v1"), viaItemKey("v2"))).toBe(false);
  });

  test("circular pads are exact discs, not the circumscribed DRC polygon", () => {
    // `padOutlineWorldMm` inflates arcs by sec(π/48) ≈ 1.0021 so DRC never
    // misses a short. On two 1 mm circles that bias is ~2 µm of radius each —
    // enough to fuse a real 1 µm gap if connectivity reused the polygon.
    const circles = (gapMm: number) => ({
      placements: [
        padCircle("A", 0, 0, 1),
        padCircle("B", 1 + gapMm, 0, 1),
      ],
      padNetIds: new Map([["A|1", "n1"], ["B|1", "n1"]]),
    });
    expect(
      pair(circles(0), padItemKey("A", "1"), padItemKey("B", "1")),
    ).toBe(true);
    expect(
      pair(circles(0.001), padItemKey("A", "1"), padItemKey("B", "1")),
    ).toBe(false);
  });

  test("a trace end cap tangent to a circular pad contacts it", () => {
    // Cap radius 0.1 + pad radius 0.5 = 0.6: the endpoint sits exactly 0.6 mm
    // from the pad centre.
    const items = buildItems({
      placements: [padCircle("A", 0, 0, 1)],
      padNetIds: new Map([["A|1", "n1"]]),
      traces: [trace("t1", "n1", [[3, 0], [0.6, 0]], { widthMm: 0.2 })],
    });
    const result = computeConnectivity(items);
    expect([...result.endpointContacts.get(traceItemKey("t1"))![1]]).toEqual([
      padItemKey("A", "1"),
    ]);
    expect(result.components).toHaveLength(1);
  });

  test("pour touches exactly its members; islands of ONE pour never touch", () => {
    const items = buildItems({ traces: [trace("t1", "gnd", [[0, 0], [5, 0]])] });
    const island = pourCopperItem({
      layer: "F.Cu",
      netId: "gnd",
      pourIndex: 0,
      index: 0,
      rings: [square(-10, -10, 10, 10)],
      memberKeys: [traceItemKey("t1")],
    });
    // Same pour, another island: disjoint by construction even if the rings
    // were to coincide, so the predicate must refuse without looking.
    const sibling = pourCopperItem({
      layer: "F.Cu",
      netId: "gnd",
      pourIndex: 0,
      index: 1,
      rings: [square(-10, -10, 10, 10)],
      memberKeys: [],
    });
    expect(copperTouch(byKey(items, traceItemKey("t1")), island)).toBe(true);
    expect(copperTouch(island, byKey(items, traceItemKey("t1")))).toBe(true);
    expect(copperTouch(byKey(items, traceItemKey("t1")), sibling)).toBe(false);
    expect(copperTouch(island, sibling)).toBe(false);
  });

  test("islands of DIFFERENT pours merge where they overlap or abut", () => {
    const base = { layer: "F.Cu" as const, netId: "gnd", index: 0, memberKeys: [] };
    const zoneA = pourCopperItem({
      ...base,
      pourIndex: 0,
      rings: [square(1, 1, 10, 10)],
    });
    const overlapping = pourCopperItem({
      ...base,
      pourIndex: 1,
      rings: [square(8, 1, 18, 10)],
    });
    const abutting = pourCopperItem({
      ...base,
      pourIndex: 1,
      rings: [square(10, 1, 18, 10)],
    });
    const disjoint = pourCopperItem({
      ...base,
      pourIndex: 1,
      rings: [square(12, 1, 18, 10)],
    });
    expect(copperTouch(zoneA, overlapping)).toBe(true);
    expect(copperTouch(overlapping, zoneA)).toBe(true);
    expect(copperTouch(zoneA, abutting)).toBe(true); // shared edge at x = 10
    expect(copperTouch(zoneA, disjoint)).toBe(false);
    // Their keys stay distinct even though layer, net and island index match.
    expect(zoneA.key).toBe("pour:F.Cu:gnd:0:0");
    expect(overlapping.key).toBe("pour:F.Cu:gnd:1:0");
  });
});

// --------------------------------------------------------------------------
// 2. Layer semantics
// --------------------------------------------------------------------------

describe("layers", () => {
  test("copper on two layers meeting at a point does NOT connect without a via", () => {
    const result = computeConnectivity(
      buildItems({
        traces: [
          trace("t1", "n1", [[0, 0], [5, 0]]),
          trace("t2", "n1", [[5, 0], [5, 5]], { layer: "B.Cu" }),
        ],
      }),
    );
    expect(componentKeys(result)).toEqual([[traceItemKey("t1")], [traceItemKey("t2")]]);
  });

  test("a through via at a trace INTERIOR joins both layers into one component", () => {
    const result = computeConnectivity(
      buildItems({
        traces: [
          trace("t1", "n1", [[0, 0], [10, 0]]),
          trace("t2", "n1", [[5, -5], [5, 5]], { layer: "B.Cu" }),
        ],
        vias: [via("v1", { netId: "n1", center: { x: 5, y: 0 } })],
      }),
    );
    expect(componentKeys(result)).toEqual([
      [traceItemKey("t1"), traceItemKey("t2"), viaItemKey("v1")],
    ]);
  });

  test("a blind F.Cu→In1.Cu via joins those two layers only", () => {
    const result = computeConnectivity(
      buildItems({
        layerCount: 4,
        traces: [
          trace("f", "n1", [[0, 0], [10, 0]]),
          trace("in1", "n1", [[5, -5], [5, 5]], { layer: "In1.Cu" }),
          trace("in2", "n1", [[5, -5], [5, 5]], { layer: "In2.Cu" }),
        ],
        vias: [
          via("v1", {
            netId: "n1",
            center: { x: 5, y: 0 },
            fromLayer: "F.Cu",
            toLayer: "In1.Cu",
          }),
        ],
      }),
    );
    expect(componentKeys(result)).toEqual([
      [traceItemKey("f"), traceItemKey("in1"), viaItemKey("v1")],
      [traceItemKey("in2")],
    ]);
  });

  test("a std free pad bridges both sides; an smd free pad stays on its own layer", () => {
    const bridged = computeConnectivity(
      buildItems({
        freePads: [freePad("fp", { padType: "std", drillMm: 0.8, widthMm: 2, heightMm: 2, netId: "n1" })],
        traces: [
          trace("f", "n1", [[0, 0], [5, 0]]),
          trace("b", "n1", [[0, 0], [-5, 0]], { layer: "B.Cu" }),
        ],
      }),
    );
    expect(componentKeys(bridged)).toEqual([
      [freePadItemKey("fp"), traceItemKey("b"), traceItemKey("f")],
    ]);

    const split = computeConnectivity(
      buildItems({
        freePads: [freePad("fp", { padType: "smd", layer: "B.Cu", widthMm: 2, heightMm: 2, netId: "n1" })],
        traces: [trace("f", "n1", [[0, 0], [5, 0]])],
      }),
    );
    expect(componentKeys(split)).toEqual([[freePadItemKey("fp")], [traceItemKey("f")]]);
  });

  test("a free pad on a non-copper layer is layer-invalid, with the DRC fallback kept in the record", () => {
    const records = buildCopperRecords(
      input({
        freePads: [
          freePad("fp1", {
            padType: "smd",
            layer: "F.SilkS" as never,
            netId: "n1",
          }),
        ],
      }),
    );
    expect(records.pads[0]!.declaredLayerInvalid).toBe(true);
    expect(records.pads[0]!.resolvedLayers).toEqual(["F.Cu"]);
    const item = byKey(toCopperItems(records), freePadItemKey("fp1"));
    expect(item.kind === "pad" && item.layers).toEqual([]);
  });

  test("a layer-invalid pad is isolated but still an item with no layer", () => {
    const items = buildItems({
      placements: [padPart("U1", 0, 0, 2, { layer: "In1.Cu" })],
      padNetIds: new Map([["U1|1", "n1"]]),
      traces: [trace("t1", "n1", [[0, 0], [5, 0]])],
    });
    const padItem = byKey(items, padItemKey("U1", "1"));
    expect(padItem.kind === "pad" && padItem.layers).toEqual([]);
    expect(componentKeys(computeConnectivity(items))).toEqual([
      [padItemKey("U1", "1")],
      [traceItemKey("t1")],
    ]);
  });
});

// --------------------------------------------------------------------------
// 3. Pour islands
// --------------------------------------------------------------------------

describe("pour islands", () => {
  test("an island's members become one component (trace → via → island → pad)", () => {
    const items = buildItems({
      placements: [padPart("U1", 40, 0)],
      padNetIds: new Map([["U1|1", "gnd"]]),
      traces: [trace("t1", "gnd", [[0, 0], [5, 0]])],
      vias: [via("v1", { netId: "gnd", center: { x: 20, y: 0 } })],
    });
    const island = pourCopperItem({
      layer: "F.Cu",
      netId: "gnd",
      pourIndex: 0,
      index: 0,
      rings: [square(-10, -10, 50, 10)],
      memberKeys: [traceItemKey("t1"), viaItemKey("v1"), padItemKey("U1", "1")],
    });
    const result = computeConnectivity([...items, island]);
    expect(componentKeys(result)).toEqual([
      [
        padItemKey("U1", "1"),
        "pour:F.Cu:gnd:0:0",
        traceItemKey("t1"),
        viaItemKey("v1"),
      ],
    ]);
  });

  test("membership is re-checked: a member that does not occupy the poured layer is not unioned", () => {
    // The fill kernel decides via/layer crossing without a board layer count,
    // so it can list copper this stackup does not actually have on the layer.
    const items = buildItems({
      traces: [
        trace("f", "gnd", [[0, 0], [5, 0]]),
        trace("b", "gnd", [[20, 0], [25, 0]], { layer: "B.Cu" }),
      ],
      // F.Cu → In1.Cu is not a valid span on a 2-layer board.
      vias: [
        via("v1", {
          netId: "gnd",
          center: { x: 10, y: 0 },
          fromLayer: "F.Cu",
          toLayer: "In1.Cu",
        }),
      ],
    });
    const island = pourCopperItem({
      layer: "F.Cu",
      netId: "gnd",
      pourIndex: 0,
      index: 0,
      rings: [square(-10, -10, 30, 10)],
      memberKeys: [traceItemKey("f"), traceItemKey("b"), viaItemKey("v1")],
    });
    const result = computeConnectivity([...items, island]);
    expect(componentKeys(result)).toEqual([
      ["pour:F.Cu:gnd:0:0", traceItemKey("f")],
      [traceItemKey("b")],
      [viaItemKey("v1")],
    ]);
  });

  test("an endpoint inside a hole ring is outside the island's copper", () => {
    const rings = [square(-10, -10, 10, 10), square(-2, -2, 2, 2)];
    expect(pointToIslandDistance({ x: 0, y: 0 }, rings)).toBeCloseTo(2, 9);
    expect(pointToIslandDistance({ x: 5, y: 0 }, rings)).toBe(0);

    const items = buildItems({
      traces: [
        trace("hole", "gnd", [[0, 0], [0, 8]]),
        trace("solid", "gnd", [[5, 0], [5, 8]]),
      ],
    });
    const island = pourCopperItem({
      layer: "F.Cu",
      netId: "gnd",
      pourIndex: 0,
      index: 0,
      rings,
      memberKeys: [],
    });
    const result = computeConnectivity([...items, island]);
    expect([...result.endpointContacts.get(traceItemKey("hole"))![0]]).toEqual([]);
    expect([...result.endpointContacts.get(traceItemKey("solid"))![0]]).toEqual([
      "pour:F.Cu:gnd:0:0",
    ]);
  });
});
