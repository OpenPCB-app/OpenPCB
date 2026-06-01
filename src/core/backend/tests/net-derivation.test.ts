import { describe, expect, test } from "bun:test";
import {
  netEndpointCount,
  netIsConnected,
} from "../../../modules/designer/backend/erc/erc-engine";
import { deriveNetsAndJunctions } from "../../../modules/designer/backend/projection-world";
import type {
  DesignerLabel,
  DesignerPin,
  DesignerPlacedPart,
  DesignerPrimitive,
  DesignerWire,
} from "../../../sdks/designer";

function pin(
  id: string,
  worldX: number,
  worldY: number,
  electricalType = "passive",
): DesignerPin {
  return {
    id,
    originPinKey: id,
    number: "1",
    name: "P",
    electricalType,
    unit: 1,
    localPositionNm: { x: 0, y: 0 },
    worldPositionNm: { x: worldX, y: worldY },
  };
}

function part(
  id: string,
  reference: string,
  pins: DesignerPin[],
): DesignerPlacedPart {
  return {
    id,
    componentId: "comp-1",
    reference,
    value: "X",
    positionNm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    propertiesJson: {},
    symbol: {
      symbolId: "sym",
      name: "sym",
      referencePrefix: null,
      sourceHash: null,
      pins: [],
      preview: {
        kind: "symbol",
        units: "mm",
        name: "sym",
        unitCount: 1,
        graphics: [],
        pins: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
    footprint: {
      footprintId: "fp",
      name: "fp",
      mountType: null,
      sourceHash: null,
      preview: null,
    },
    pins,
  };
}

describe("net derivation — connected semantics", () => {
  test("an isolated pin still produces a standalone single-endpoint net", () => {
    const parts = [part("u1", "U1", [pin("u1-1", 1000, 0)])];
    const { nets } = deriveNetsAndJunctions(parts, [], [], []);
    expect(nets).toHaveLength(1);
    const net = nets[0]!;
    expect(net.pinIds).toEqual(["u1-1"]);
    // Single endpoint → not a real connection.
    expect(netEndpointCount(net)).toBe(1);
    expect(netIsConnected(net)).toBe(false);
  });

  test("two pins at the same point form one connected net", () => {
    const parts = [
      part("u1", "U1", [pin("u1-1", 5000, 5000)]),
      part("u2", "U2", [pin("u2-1", 5000, 5000)]),
    ];
    const { nets } = deriveNetsAndJunctions(parts, [], [], []);
    const merged = nets.find((n) => n.pinIds.length === 2);
    expect(merged).toBeDefined();
    expect(netIsConnected(merged!)).toBe(true);
    expect(netEndpointCount(merged!)).toBe(2);
  });

  test("a pin joined to a wire is a connected net even when alone", () => {
    const pinA = pin("u1-1", 0, 0);
    const parts = [part("u1", "U1", [pinA])];
    const wire: DesignerWire = {
      id: "w1",
      sourcePinId: "u1-1",
      targetPinId: "open",
      pointsNm: [
        { x: 0, y: 0 },
        { x: 10000, y: 0 },
      ],
    };
    const { nets } = deriveNetsAndJunctions(parts, [wire], [], []);
    const net = nets.find((n) => n.pinIds.includes("u1-1"))!;
    expect(net.wireIds).toContain("w1");
    expect(netIsConnected(net)).toBe(true);
  });

  test("a pin under a label is a connected net even when alone", () => {
    const parts = [part("u1", "U1", [pin("u1-1", 0, 0)])];
    const label: DesignerLabel = {
      id: "lbl-1",
      text: "SIG",
      positionNm: { x: 0, y: 0 },
    };
    const { nets } = deriveNetsAndJunctions(parts, [], [label], []);
    const net = nets.find((n) => n.pinIds.includes("u1-1"))!;
    expect(net.labelIds).toContain("lbl-1");
    expect(netIsConnected(net)).toBe(true);
  });

  test("a pin under a power primitive is a connected net even when alone", () => {
    const parts = [part("u1", "U1", [pin("u1-1", 0, 0, "power_in")])];
    const pwr: DesignerPrimitive = {
      id: "prim-vcc",
      kind: "pwr",
      positionNm: { x: 0, y: 0 },
      rotationDeg: 0,
      railText: "VCC",
    };
    const { nets } = deriveNetsAndJunctions(parts, [], [], [pwr]);
    const net = nets.find((n) => n.pinIds.includes("u1-1"))!;
    expect(net.primitiveIds).toContain("prim-vcc");
    expect(netIsConnected(net)).toBe(true);
    expect(net.name).toBe("VCC");
  });
});
