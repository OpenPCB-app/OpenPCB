import { describe, expect, test } from "bun:test";
import { deriveNetsAndJunctions } from "../../../modules/designer/backend/projection-world";
import type {
  DesignerLabel,
  DesignerPrimitive,
  DesignerWire,
} from "../../../sdks/designer";

const wire = (id: string, pts: Array<[number, number]>): DesignerWire => ({
  id,
  sourcePinId: "x",
  targetPinId: "y",
  pointsNm: pts.map(([x, y]) => ({ x, y })),
});
const label = (id: string, text: string, x: number, y: number): DesignerLabel => ({
  id,
  text,
  positionNm: { x, y },
});
const gnd = (id: string, x: number, y: number): DesignerPrimitive => ({
  id,
  kind: "gnd",
  positionNm: { x, y },
  rotationDeg: 0,
});

describe("attach state (labels / ports)", () => {
  const w = wire("w1", [
    [0, 0],
    [10_000_000, 0],
  ]);

  test("label on a wire segment is attached", () => {
    const r = deriveNetsAndJunctions([], [w], [label("l1", "A", 5_000_000, 0)]);
    expect(r.attachedLabelIds.has("l1")).toBe(true);
  });

  test("same-name label in empty space is floating yet still on the net", () => {
    const labels = [
      label("l1", "SIG", 5_000_000, 0),
      label("l2", "SIG", 5_000_000, 50_000_000),
    ];
    const r = deriveNetsAndJunctions([], [w], labels);
    expect(r.attachedLabelIds.has("l1")).toBe(true);
    expect(r.attachedLabelIds.has("l2")).toBe(false);
    const net = r.nets.find((n) => n.labelIds.includes("l2"))!;
    expect(net.labelIds).toContain("l1");
    expect(net.wireIds).toContain("w1");
  });

  test("moving a label off the wire flips it to floating", () => {
    const on = deriveNetsAndJunctions([], [w], [label("l1", "A", 5_000_000, 0)]);
    const off = deriveNetsAndJunctions(
      [],
      [w],
      [label("l1", "A", 5_000_000, 3_000_000)],
    );
    expect(on.attachedLabelIds.has("l1")).toBe(true);
    expect(off.attachedLabelIds.has("l1")).toBe(false);
  });

  test("GND port on a wire end is attached; in empty space floating", () => {
    const r = deriveNetsAndJunctions([], [w], [], [
      gnd("g1", 10_000_000, 0),
      gnd("g2", 5_000_000, 0),
      gnd("g3", 40_000_000, 40_000_000),
    ]);
    expect(r.attachedPrimitiveIds.has("g1")).toBe(true);
    expect(r.attachedPrimitiveIds.has("g2")).toBe(true);
    expect(r.attachedPrimitiveIds.has("g3")).toBe(false);
    // Name union still merges all GND ports into one net.
    const net = r.nets.find((n) => n.primitiveIds.includes("g3"))!;
    expect(net.primitiveIds).toContain("g1");
  });

  test("nets are identical to the pre-change derivation shape", () => {
    const r = deriveNetsAndJunctions([], [w], [label("l1", "A", 5_000_000, 0)], [
      gnd("g1", 10_000_000, 0),
    ]);
    expect(r.nets).toHaveLength(1);
    expect(r.nets[0]).toMatchObject({
      name: "GND",
      wireIds: ["w1"],
      labelIds: ["l1"],
      primitiveIds: ["g1"],
    });
  });
});
