/**
 * Copper records → fail-safe items (docs/pcb-hardening/01-connectivity-contract.md
 * §2). The records ARE the geometry the DRC context builds today; the items are
 * that geometry under the connectivity layer policy, where a layer-invalid pad
 * or via occupies no layer at all and therefore cannot manufacture a connection.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCopperRecords,
  freePadItemKey,
  padItemKey,
  toCopperItems,
  traceItemKey,
  viaItemKey,
  type CopperItem,
  type CopperRecordsInput,
} from "../../../shared/pcb-connectivity";
import type { PcbLayerCount } from "../../../sdks/designer";
import { freePad, pad, placement, trace, via } from "./helpers/drc-fixtures";

function input(parts: Partial<CopperRecordsInput> = {}): CopperRecordsInput {
  return {
    layerCount: (parts.layerCount ?? 2) as PcbLayerCount,
    placements: parts.placements ?? [],
    padNetIds: parts.padNetIds ?? new Map(),
    freePads: parts.freePads ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
  };
}

function itemByKey(items: CopperItem[], key: string): CopperItem {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`missing item ${key}`);
  return found;
}

describe("copper records — footprint pads", () => {
  test("a drilled pad resolves to every valid copper layer", () => {
    const records = buildCopperRecords(
      input({
        layerCount: 4,
        placements: [
          placement("U1", { pads: [pad("1", { x: 0, y: 0 }, 1, 1, { drillDiameterMm: 0.6 })] }),
        ],
      }),
    );
    expect(records.pads[0]!.resolvedLayers).toEqual([
      "F.Cu",
      "In1.Cu",
      "In2.Cu",
      "B.Cu",
    ]);
    expect(records.pads[0]!.declaredLayerInvalid).toBe(false);
    expect(records.pads[0]!.drillMm).toBe(0.6);
  });

  test("an SMD pad on a B.Cu placement is side-flipped", () => {
    const records = buildCopperRecords(
      input({
        placements: [
          placement("U1", {
            layer: "B.Cu",
            pads: [pad("1", { x: 0, y: 0 }, 1, 1, { layer: "F.Cu" })],
          }),
        ],
      }),
    );
    expect(records.pads[0]!.resolvedLayers).toEqual(["B.Cu"]);
  });

  test("an In1.Cu pad on a 2-layer board is layer-invalid: record keeps the fallback, item has no layer", () => {
    const records = buildCopperRecords(
      input({
        placements: [
          placement("U1", { pads: [pad("1", { x: 0, y: 0 }, 1, 1, { layer: "In1.Cu" })] }),
        ],
      }),
    );
    expect(records.pads[0]!.declaredLayerInvalid).toBe(true);
    expect(records.pads[0]!.resolvedLayers).toEqual(["F.Cu"]);
    const item = itemByKey(toCopperItems(records), padItemKey("U1", "1"));
    expect(item.kind).toBe("pad");
    expect(item.kind === "pad" && item.layers).toEqual([]);
  });
});

describe("copper records — free pads", () => {
  test("an NPTH free pad produces no record", () => {
    const records = buildCopperRecords(
      input({ freePads: [freePad("h1", { padType: "hole", drillMm: 1 })] }),
    );
    expect(records.pads).toEqual([]);
  });

  test("a std free pad spans every valid layer, an smd free pad only its own", () => {
    const records = buildCopperRecords(
      input({
        layerCount: 4,
        freePads: [
          freePad("fp-std", { padType: "std", drillMm: 0.8 }),
          freePad("fp-smd", { padType: "smd", layer: "B.Cu" }),
        ],
      }),
    );
    expect(records.pads[0]!.resolvedLayers).toEqual([
      "F.Cu",
      "In1.Cu",
      "In2.Cu",
      "B.Cu",
    ]);
    expect(records.pads[1]!.resolvedLayers).toEqual(["B.Cu"]);
    expect(records.pads[1]!.declaredLayerInvalid).toBe(false);
  });

  test("an off-stackup smd free pad is layer-invalid and loses its layer as an item", () => {
    const records = buildCopperRecords(
      input({ freePads: [freePad("fp1", { padType: "smd", layer: "In1.Cu" })] }),
    );
    expect(records.pads[0]!.declaredLayerInvalid).toBe(true);
    const item = itemByKey(toCopperItems(records), freePadItemKey("fp1"));
    expect(item.kind === "pad" && item.layers).toEqual([]);
  });
});

describe("copper records — vias", () => {
  test("a via reaching an inner layer that does not exist has an invalid span", () => {
    const records = buildCopperRecords(
      input({ vias: [via("v1", { fromLayer: "F.Cu", toLayer: "In1.Cu" })] }),
    );
    expect(records.vias[0]!.span).toEqual([]);
    expect(records.vias[0]!.layerSpanInvalid).toBe(true);
    const item = itemByKey(toCopperItems(records), viaItemKey("v1"));
    expect(item.kind === "via" && item.layers).toEqual([]);
  });

  test("a blind via on a 4-layer board spans exactly its two layers", () => {
    const records = buildCopperRecords(
      input({
        layerCount: 4,
        vias: [via("v1", { fromLayer: "F.Cu", toLayer: "In1.Cu" })],
      }),
    );
    expect(records.vias[0]!.span).toEqual(["F.Cu", "In1.Cu"]);
    expect(records.vias[0]!.layerSpanInvalid).toBe(false);
    const item = itemByKey(toCopperItems(records), viaItemKey("v1"));
    expect(item.kind === "via" && item.layers).toEqual(["F.Cu", "In1.Cu"]);
  });
});

describe("copper records — traces and ordering", () => {
  test("a trace with fewer than two points keeps its record but has no item", () => {
    const records = buildCopperRecords(
      input({ traces: [trace("t1", "n1", [[0, 0]]), trace("t2", "n1", [[0, 0], [1, 0]])] }),
    );
    expect(records.traces.map((t) => t.id)).toEqual(["t1", "t2"]);
    const keys = toCopperItems(records).map((i) => i.key);
    expect(keys).toEqual([traceItemKey("t2")]);
  });

  test("item keys use the documented prefixes", () => {
    const records = buildCopperRecords(
      input({
        placements: [placement("U1", { pads: [pad("A1", { x: 0, y: 0 }, 1, 1)] })],
        freePads: [freePad("fp1")],
        traces: [trace("t1", "n1", [[0, 0], [1, 0]])],
        vias: [via("v1")],
      }),
    );
    expect(toCopperItems(records).map((i) => i.key)).toEqual([
      padItemKey("U1", "A1"),
      "freepad:fp1",
      "trace:t1",
      "via:v1",
    ]);
  });

  test("records preserve input order: footprint pads, then free pads", () => {
    const records = buildCopperRecords(
      input({
        placements: [
          placement("U2", { pads: [pad("1", { x: 0, y: 0 }, 1, 1), pad("2", { x: 2, y: 0 }, 1, 1)] }),
          placement("U1", { positionMm: { x: 10, y: 0 }, pads: [pad("1", { x: 0, y: 0 }, 1, 1)] }),
        ],
        freePads: [freePad("fpB"), freePad("fpA")],
        traces: [trace("t2", null, [[0, 0], [1, 0]]), trace("t1", null, [[0, 5], [1, 5]])],
        vias: [via("v2"), via("v1")],
      }),
    );
    expect(records.pads.map((p) => p.anchor)).toEqual([
      { kind: "pad", placementId: "U2", padNumber: "1" },
      { kind: "pad", placementId: "U2", padNumber: "2" },
      { kind: "pad", placementId: "U1", padNumber: "1" },
      { kind: "freePad", freePadId: "fpB" },
      { kind: "freePad", freePadId: "fpA" },
    ]);
    expect(records.traces.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(records.vias.map((v) => v.via.id)).toEqual(["v2", "v1"]);
  });

  test("pad nets come from the padNets correlation map", () => {
    const records = buildCopperRecords(
      input({
        placements: [placement("U1", { pads: [pad("1", { x: 0, y: 0 }, 1, 1), pad("2", { x: 2, y: 0 }, 1, 1)] })],
        padNetIds: new Map([["U1|1", "vcc"]]),
      }),
    );
    expect(records.pads.map((p) => p.netId)).toEqual(["vcc", null]);
  });
});

/**
 * An unplated pad's copper is mechanical (manufacturability contract 10 §2.4):
 * the RECORD keeps the net so DRC clearance and the pour still see it, but the
 * kernel splits it into one NULL-net item per copper layer, because two rings
 * of one unplated hole are never one node.
 */
describe("copper records — unplated pads (contract 10 §2.4)", () => {
  const npthPad = (opts: { number?: string } = {}) =>
    pad(opts.number ?? "1", { x: 0, y: 0 }, 4, 4, {
      shape: "circle",
      drillDiameterMm: 3.2,
      plated: false,
      layer: "*.Cu",
    });

  test("a plated drilled pad is ONE item spanning every layer", () => {
    const records = buildCopperRecords(
      input({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 4, 4, {
                shape: "circle",
                drillDiameterMm: 3.2,
                layer: "*.Cu",
              }),
            ],
          }),
        ],
        padNetIds: new Map([["U1|1", "n1"]]),
      }),
    );
    expect(records.pads[0]!.plated).toBe(true);
    const items = toCopperItems(records);
    expect(items).toHaveLength(1);
    const item = itemByKey(items, padItemKey("U1", "1"));
    expect(item.kind === "pad" && item.layers).toEqual(["F.Cu", "B.Cu"]);
    expect(item.netId).toBe("n1");
  });

  test("an unplated ring is one NULL-net item PER copper layer", () => {
    const records = buildCopperRecords(
      input({
        placements: [placement("U1", { pads: [npthPad()] })],
        padNetIds: new Map([["U1|1", "n1"]]),
      }),
    );
    // The record keeps the net (clearance and the pour still see the copper).
    expect(records.pads[0]!.plated).toBe(false);
    expect(records.pads[0]!.netId).toBe("n1");

    const items = toCopperItems(records);
    expect(items.map((i) => i.key)).toEqual([
      padItemKey("U1", "1", 0, "F.Cu"),
      padItemKey("U1", "1", 0, "B.Cu"),
    ]);
    for (const item of items) {
      expect(item.netId).toBeNull();
      expect(item.kind === "pad" && item.layers.length).toBe(1);
      // The DRC anchor stays per PAD — only the kernel splits.
      expect(item.kind === "pad" && item.anchor).toEqual({
        kind: "pad",
        placementId: "U1",
        padNumber: "1",
      });
    }
    // The 3-tuple key the pour's membership is built from matches NOTHING.
    expect(items.some((i) => i.key === padItemKey("U1", "1"))).toBe(false);
  });

  test("a copper-LESS unplated pad has no record at all, plated or not", () => {
    // Copper 3.2 inside a 3.2 drill (contract 10 §2.3).
    const gone = buildCopperRecords(
      input({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 3.2, 3.2, {
                shape: "circle",
                drillDiameterMm: 3.2,
                plated: false,
                layer: "*.Cu",
              }),
            ],
          }),
        ],
      }),
    );
    expect(gone.pads).toEqual([]);
    // The same geometry PLATED keeps its record: containment only removes the
    // copper of a non-plated pad.
    const kept = buildCopperRecords(
      input({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 3.2, 3.2, {
                shape: "circle",
                drillDiameterMm: 3.2,
                layer: "*.Cu",
              }),
            ],
          }),
        ],
      }),
    );
    expect(kept.pads).toHaveLength(1);
  });

  test("a drilled smd free pad is an NPTH hit, but its single-layer copper keeps its net", () => {
    // Contract 10 §2.4 (Astra run 2): the per-layer null-net split exists only
    // to deny conduction BETWEEN faces. A drilled `smd` free pad has copper on
    // exactly one layer — a test point with a probe hole — so there is no
    // barrel to fake: it is `plated: false` for the hole model, yet it keeps
    // its net and its one item.
    const records = buildCopperRecords(
      input({
        freePads: [
          freePad("fp-std", { padType: "std", drillMm: 0.8, netId: "n1" }),
          freePad("fp-smd", { padType: "smd", drillMm: 0.5, netId: "n2" }),
          freePad("fp-dry", { padType: "smd", netId: "n3" }),
        ],
      }),
    );
    expect(records.pads.map((p) => p.plated)).toEqual([true, false, true]);
    const items = toCopperItems(records);
    expect(items.map((i) => i.key)).toEqual([
      freePadItemKey("fp-std"),
      freePadItemKey("fp-smd"),
      freePadItemKey("fp-dry"),
    ]);
    expect(items.map((i) => i.netId)).toEqual(["n1", "n2", "n3"]);
  });
});
