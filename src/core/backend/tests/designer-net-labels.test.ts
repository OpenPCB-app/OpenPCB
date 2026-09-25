import { describe, expect, test } from "bun:test";
import { deriveNetsAndJunctions } from "../../../modules/designer/backend/projection-world";
import type {
  DesignerLabel,
  DesignerPin,
  DesignerPlacedPart,
  DesignerPrimitive,
  DesignerWire,
} from "../../../sdks/designer";
import { SCHEMATIC_LABEL_ATTACH_TOLERANCE_NM } from "../../../sdks/designer";

const MM = 1_000_000;

function part(id: string, pinId: string, x: number, y: number): DesignerPlacedPart {
  const pin: DesignerPin = {
    id: pinId,
    originPinKey: pinId,
    number: "1",
    name: "P",
    electricalType: "passive",
    unit: 1,
    localPositionNm: { x: 0, y: 0 },
    worldPositionNm: { x, y },
  };
  return {
    id,
    componentId: "comp",
    reference: id.toUpperCase(),
    value: "X",
    positionNm: { x, y },
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
    pins: [pin],
  };
}

/** R1 pin at (0,0) wired to D1 pin at (20 mm, 0) along y = 0. */
function wiredPair(): { parts: DesignerPlacedPart[]; wire: DesignerWire } {
  return {
    parts: [part("r1", "r1-1", 0, 0), part("d1", "d1-1", 20 * MM, 0)],
    wire: {
      id: "w1",
      sourcePinId: "r1-1",
      targetPinId: "d1-1",
      pointsNm: [
        { x: 0, y: 0 },
        { x: 20 * MM, y: 0 },
      ],
    },
  };
}

function label(id: string, text: string, x: number, y: number): DesignerLabel {
  return { id, text, positionNm: { x, y } };
}

function netOf(
  nets: ReturnType<typeof deriveNetsAndJunctions>["nets"],
  pinId: string,
) {
  return nets.find((net) => net.pinIds.includes(pinId))!;
}

describe("net labels connect like KiCad local labels (T-097)", () => {
  test("a label on a segment INTERIOR names the wire's net", () => {
    const { parts, wire } = wiredPair();
    const { nets } = deriveNetsAndJunctions(
      parts,
      [wire],
      [label("l1", "LED_A", 7 * MM, 0)],
    );
    const net = netOf(nets, "r1-1");
    expect(net.name).toBe("LED_A");
    expect(net.labelIds).toEqual(["l1"]);
    expect(net.wireIds).toEqual(["w1"]);
  });

  test("a label a click's width off the wire still attaches; one past the tolerance does not", () => {
    const { parts, wire } = wiredPair();
    const within = deriveNetsAndJunctions(
      parts,
      [wire],
      // The QA repro: the anchor landed 0.0332 mm off the wire.
      [label("l1", "NET", 7 * MM, -33_200)],
    );
    expect(netOf(within.nets, "r1-1").labelIds).toEqual(["l1"]);

    const beyond = deriveNetsAndJunctions(
      parts,
      [wire],
      [label("l1", "NET", 7 * MM, SCHEMATIC_LABEL_ATTACH_TOLERANCE_NM + 1)],
    );
    expect(netOf(beyond.nets, "r1-1").labelIds).toEqual([]);
    expect(netOf(beyond.nets, "r1-1").name).not.toBe("NET");
  });

  test("a label at a wire END or a pin attaches too", () => {
    const { parts, wire } = wiredPair();
    const { nets } = deriveNetsAndJunctions(
      parts,
      [wire],
      [label("l1", "END", 20 * MM + 40_000, 0)],
    );
    expect(netOf(nets, "d1-1").labelIds).toEqual(["l1"]);

    const onPin = deriveNetsAndJunctions(
      [part("u1", "u1-1", 5 * MM, 5 * MM)],
      [],
      [label("l2", "PIN", 5 * MM, 5 * MM - 50_000)],
    );
    expect(netOf(onPin.nets, "u1-1").labelIds).toEqual(["l2"]);
  });

  test("same-text labels merge their nets with no wire between them (case-insensitive)", () => {
    const parts = [part("u1", "u1-1", 0, 0), part("u2", "u2-1", 50 * MM, 0)];
    const { nets } = deriveNetsAndJunctions(parts, [], [
      label("l1", "SDA", 0, 0),
      label("l2", "sda", 50 * MM, 0),
      label("l3", "SCL", 90 * MM, 90 * MM),
    ]);
    const sda = netOf(nets, "u1-1");
    expect(sda.pinIds).toEqual(["u1-1", "u2-1"]);
    expect(sda.labelIds).toEqual(["l1", "l2"]);
    // One name, one net: no second "SDA" net, and SCL stays its own.
    expect(nets.filter((net) => net.name.toUpperCase() === "SDA")).toHaveLength(1);
    expect(nets.find((net) => net.labelIds.includes("l3"))?.pinIds).toEqual([]);
  });

  test("a label shares the ONE name namespace with power rails", () => {
    const parts = [part("u1", "u1-1", 0, 0), part("u2", "u2-1", 50 * MM, 0)];
    const vcc: DesignerPrimitive = {
      id: "p1",
      kind: "pwr",
      positionNm: { x: 50 * MM, y: 0 },
      rotationDeg: 0,
      railText: "VCC",
    };
    const { nets } = deriveNetsAndJunctions(
      parts,
      [],
      [label("l1", "VCC", 0, 0)],
      [vcc],
    );
    const net = netOf(nets, "u1-1");
    expect(net.pinIds).toEqual(["u1-1", "u2-1"]);
    expect(net.name).toBe("VCC");
  });

  test("labels still never create junction dots", () => {
    const { parts, wire } = wiredPair();
    const { junctions } = deriveNetsAndJunctions(parts, [wire], [
      label("l1", "A", 7 * MM, 0),
    ]);
    expect(junctions).toEqual([]);
  });
});
