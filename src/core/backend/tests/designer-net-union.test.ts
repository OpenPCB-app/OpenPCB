import { describe, expect, test } from "bun:test";
import { deriveNetsAndJunctions } from "../../../modules/designer/backend/projection-world";
import type { DesignerPrimitive } from "../../../sdks/designer";

function gnd(id: string, x: number, y: number): DesignerPrimitive {
  return { id, kind: "gnd", positionNm: { x, y }, rotationDeg: 0 };
}
function pwr(
  id: string,
  rail: string,
  x: number,
  y: number,
): DesignerPrimitive {
  return {
    id,
    kind: "pwr",
    railText: rail,
    positionNm: { x, y },
    rotationDeg: 0,
  };
}
function portal(
  id: string,
  text: string,
  x: number,
  y: number,
): DesignerPrimitive {
  return {
    id,
    kind: "net_portal",
    portalText: text,
    positionNm: { x, y },
    rotationDeg: 0,
  };
}

describe("global named-net union", () => {
  test("all GND ports merge into one net even without a wire", () => {
    const { nets } = deriveNetsAndJunctions(
      [],
      [],
      [],
      [gnd("g1", 0, 0), gnd("g2", 50_000_000, 0)],
    );
    const gndNets = nets.filter((n) => n.name === "GND");
    expect(gndNets).toHaveLength(1);
    expect(gndNets[0]!.primitiveIds.sort()).toEqual(["g1", "g2"]);
  });

  test("a PWR rail and a net portal with identical text form one net", () => {
    const { nets } = deriveNetsAndJunctions(
      [],
      [],
      [],
      [pwr("p1", "+5V", 0, 0), portal("n1", "+5V", 80_000_000, 0)],
    );
    const rail = nets.filter((n) => n.name === "+5V");
    expect(rail).toHaveLength(1);
    expect(rail[0]!.primitiveIds.sort()).toEqual(["n1", "p1"]);
  });

  test("distinct named rails stay separate", () => {
    const { nets } = deriveNetsAndJunctions(
      [],
      [],
      [],
      [
        gnd("g1", 0, 0),
        pwr("p1", "+5V", 40_000_000, 0),
        portal("n1", "SDA", 80_000_000, 0),
      ],
    );
    expect(new Set(nets.map((n) => n.name))).toEqual(
      new Set(["GND", "+5V", "SDA"]),
    );
  });

  test("same rail name in different case unions into one net", () => {
    const { nets } = deriveNetsAndJunctions(
      [],
      [],
      [],
      [pwr("p1", "VCC", 0, 0), pwr("p2", "vcc", 60_000_000, 0)],
    );
    const vcc = nets.filter((n) => n.name.toUpperCase() === "VCC");
    expect(vcc).toHaveLength(1);
    expect(vcc[0]!.primitiveIds.sort()).toEqual(["p1", "p2"]);
  });

  test("a ground variant stays distinct from canonical GND", () => {
    // AGND is connected via a PWR port (railText "AGND"), not a gnd port.
    const { nets } = deriveNetsAndJunctions(
      [],
      [],
      [],
      [gnd("g1", 0, 0), pwr("p1", "AGND", 60_000_000, 0)],
    );
    expect(new Set(nets.map((n) => n.name))).toEqual(new Set(["GND", "AGND"]));
  });
});
