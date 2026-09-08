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
