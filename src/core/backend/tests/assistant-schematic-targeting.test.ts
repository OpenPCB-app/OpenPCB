import { describe, expect, test } from "bun:test";
import type { DesignerSchematicProjection } from "../../../sdks/designer";
import {
  planNetConnect,
  resolvePartTarget,
  resolvePinTarget,
  resolveWireEndpoint,
} from "../../../modules/assistant/backend/tools/schematic-targeting";

function pin(id: string, number: string, name: string, x: number, y: number) {
  return {
    id,
    originPinKey: number,
    number,
    name,
    electricalType: "passive",
    unit: 1,
    localPositionNm: { x: 0, y: 0 },
    worldPositionNm: { x, y },
  };
}

const projection = {
  designId: "d1",
  revision: 1,
  parts: [
    {
      id: "p-u1",
      componentId: "c-u",
      reference: "U1",
      value: "",
      rotationDeg: 0,
      mirrored: false,
      positionNm: { x: 0, y: 0 },
      symbol: {} as never,
      footprint: {} as never,
      propertiesJson: {},
      pins: [
        pin("p-u1:1", "1", "VCC", 0, 0),
        pin("p-u1:2", "2", "GND", 0, -2_540_000),
        pin("p-u1:3", "3", "OUT", 2_540_000, 0),
        pin("p-u1:4", "4", "~{RST}", 0, 2_540_000),
        pin("p-u1:5", "5", "CS#", 2_540_000, 2_540_000),
      ],
    },
    {
      id: "p-r1",
      componentId: "c-r",
      reference: "R1",
      value: "10k",
      rotationDeg: 0,
      mirrored: false,
      positionNm: { x: 10_000_000, y: 0 },
      symbol: {} as never,
      footprint: {} as never,
      propertiesJson: {},
      pins: [
        pin("p-r1:1", "1", "1", 10_000_000, 0),
        pin("p-r1:2", "2", "2", 12_540_000, 0),
      ],
    },
  ],
  wires: [],
  labels: [],
  primitives: [],
  nets: [],
  junctions: [],
} as unknown as DesignerSchematicProjection;

describe("schematic targeting", () => {
  test("resolves REF.PIN by name and number, case-insensitively", () => {
    expect(resolvePinTarget(projection, "U1.VCC")).toEqual({
      ok: true,
      pinId: "p-u1:1",
    });
    expect(resolvePinTarget(projection, "U1.1")).toEqual({
      ok: true,
      pinId: "p-u1:1",
    });
    expect(resolvePinTarget(projection, "r1.2")).toEqual({
      ok: true,
      pinId: "p-r1:2",
    });
    expect(resolvePinTarget(projection, { ref: "u1", pin: "gnd" })).toEqual({
      ok: true,
      pinId: "p-u1:2",
    });
  });

  test("accepts a raw pin id and { pinId }", () => {
    expect(resolvePinTarget(projection, "p-u1:3")).toEqual({
      ok: true,
      pinId: "p-u1:3",
    });
    expect(resolvePinTarget(projection, { pinId: "p-r1:1" })).toEqual({
      ok: true,
      pinId: "p-r1:1",
    });
  });

  test("resolves an active-low pin name via the overline alias", () => {
    // Symbol pin is "~{RST}"; the model typically writes "RST".
    expect(resolvePinTarget(projection, "U1.RST")).toEqual({
      ok: true,
      pinId: "p-u1:4",
    });
    // The literal decorated name and the pin number also resolve.
    expect(resolvePinTarget(projection, "U1.~{RST}")).toEqual({
      ok: true,
      pinId: "p-u1:4",
    });
    expect(resolvePinTarget(projection, "U1.4")).toEqual({
      ok: true,
      pinId: "p-u1:4",
    });
  });

  test("does NOT collapse '#' / '/' decorations (no false alias match)", () => {
    // "CS" must not silently match the pin literally named "CS#".
    expect(resolvePinTarget(projection, "U1.CS").ok).toBe(false);
    // The exact name still resolves.
    expect(resolvePinTarget(projection, "U1.CS#")).toEqual({
      ok: true,
      pinId: "p-u1:5",
    });
  });

  test("reports unknown part with candidates", () => {
    const r = resolvePinTarget(projection, "U9.1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.candidates).toContain("R1");
  });

  test("reports unknown pin on a known part", () => {
    const r = resolvePinTarget(projection, "U1.NOPE");
    expect(r.ok).toBe(false);
  });

  test("rejects malformed targets without throwing", () => {
    expect(resolvePinTarget(projection, 123 as never).ok).toBe(false);
    expect(resolvePinTarget(projection, {} as never).ok).toBe(false);
    expect(resolvePinTarget(projection, "" as never).ok).toBe(false);
  });

  test("resolveWireEndpoint distinguishes pins and nets", () => {
    expect(resolveWireEndpoint(projection, "U1.OUT")).toEqual({
      ok: true,
      kind: "pin",
      pinId: "p-u1:3",
    });
    expect(resolveWireEndpoint(projection, { net: "GND" })).toEqual({
      ok: true,
      kind: "net",
      net: "GND",
    });
    expect(resolveWireEndpoint(projection, { net: 123 } as never).ok).toBe(
      false,
    );
  });

  test("resolvePartTarget accepts ref or id", () => {
    expect(resolvePartTarget(projection, "U1")).toEqual({
      ok: true,
      partId: "p-u1",
    });
    expect(resolvePartTarget(projection, "p-r1")).toEqual({
      ok: true,
      partId: "p-r1",
    });
    expect(resolvePartTarget(projection, "Q9").ok).toBe(false);
  });

  test("planNetConnect: canonical ground → gnd port", () => {
    const gnd = planNetConnect(projection, "p-u1:1", "GND");
    expect(gnd.ok).toBe(true);
    if (gnd.ok) {
      expect(gnd.plan.primitiveCommand.type).toBe("place_gnd_port");
      expect(gnd.plan.primitiveCommand.positionNm.x).toBe(0); // straight stub
    }
  });

  test("planNetConnect: power rails → power port (not portal)", () => {
    for (const rail of [
      "+5V",
      "+3.3V",
      "3V3",
      "5V",
      "1V8",
      "VCC",
      "VDD",
      "VBUS",
    ]) {
      const r = planNetConnect(projection, "p-u1:1", rail);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.plan.primitiveCommand.type).toBe("place_pwr_port");
        if (r.plan.primitiveCommand.type === "place_pwr_port") {
          expect(r.plan.primitiveCommand.railText).toBe(rail);
        }
        expect(r.plan.primitiveCommand.positionNm.x).toBe(0); // straight vertical stub
      }
    }
  });

  test("planNetConnect: ground variants → power port (distinct from GND)", () => {
    for (const rail of ["AGND", "DGND", "VSS", "VEE"]) {
      const r = planNetConnect(projection, "p-u1:1", rail);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.plan.primitiveCommand.type).toBe("place_pwr_port");
    }
  });

  test("planNetConnect: signal/other names → net portal", () => {
    for (const net of ["SDA", "VREF", "EARTH", "AVAILABLE", "-RESET"]) {
      const r = planNetConnect(projection, "p-u1:1", net);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.plan.primitiveCommand.type).toBe("place_net_portal");
    }
  });

  test("planNetConnect rejects an unknown source pin", () => {
    expect(planNetConnect(projection, "nope", "GND").ok).toBe(false);
  });

  test("planNetConnect: pin at origin keeps the legacy vertical placement", () => {
    // VCC pin (p-u1:1) sits exactly on U1's origin → degenerate → default axis.
    const gnd = planNetConnect(projection, "p-u1:1", "GND");
    expect(gnd.ok).toBe(true);
    if (gnd.ok) {
      expect(gnd.plan.primitiveCommand.positionNm.x).toBe(0);
      // 8 mm offset on the default (+y) axis, rotation unchanged.
      expect(gnd.plan.primitiveCommand.positionNm.y).toBe(8_000_000);
      expect(gnd.plan.primitiveCommand.rotationDeg).toBe(0);
    }
  });

  test("planNetConnect: a right-pointing pin places the flag to the right", () => {
    // OUT pin (p-u1:3) at (+2.54mm, 0) points +x away from U1 origin.
    const portal = planNetConnect(projection, "p-u1:3", "SDA");
    expect(portal.ok).toBe(true);
    if (portal.ok) {
      expect(portal.plan.primitiveCommand.type).toBe("place_net_portal");
      expect(portal.plan.primitiveCommand.positionNm).toEqual({
        x: 2_540_000 + 8_000_000,
        y: 0,
      });
      // Glyph stays upright so the label is readable; only the side changes.
      expect(portal.plan.primitiveCommand.rotationDeg).toBe(0);
    }
  });

  test("planNetConnect: a downward GND pin places GND below, rotated", () => {
    // GND pin (p-u1:2) at (0, -2.54mm) points -y away from U1 origin.
    const gnd = planNetConnect(projection, "p-u1:2", "GND");
    expect(gnd.ok).toBe(true);
    if (gnd.ok) {
      expect(gnd.plan.primitiveCommand.positionNm).toEqual({
        x: 0,
        y: -2_540_000 - 8_000_000,
      });
      expect(gnd.plan.primitiveCommand.rotationDeg).toBe(0);
    }
  });
});
