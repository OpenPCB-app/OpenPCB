import { describe, it, expect } from "vitest";
import { extractNets } from "./net-extraction";
import type {
  EditorSchematicSymbol,
  NetLabelEntity,
  WireEntity,
} from "../types";

function makeSymbol(
  id: string,
  position: { x: number; y: number },
  pins: Array<{ id: string; name: string; position: { x: number; y: number } }>,
  options: { componentId?: string; reference?: string } = {},
): EditorSchematicSymbol {
  return {
    id,
    entityType: "symbol",
    position,
    rotation: 0,
    pins: pins.map((p) => ({ id: p.id, name: p.name, position: p.position })),
    symbolKind: "generic",
    reference: options.reference ?? `U${id}`,
    value: "",
    componentId: options.componentId,
  };
}

function makeWire(
  id: string,
  points: Array<{ x: number; y: number }>,
  sourcePinId?: string,
  targetPinId?: string,
): WireEntity {
  return {
    id,
    entityType: "wire",
    position: points[0] ?? { x: 0, y: 0 },
    rotation: 0,
    points,
    sourcePinId: sourcePinId ?? "",
    targetPinId: targetPinId ?? "",
  };
}

function makeLabel(
  id: string,
  text: string,
  position: { x: number; y: number },
): NetLabelEntity {
  return {
    id,
    entityType: "label",
    text,
    position,
    rotation: 0,
  };
}

describe("extractNets", () => {
  it("returns empty array for empty input", () => {
    expect(extractNets([], [], [])).toEqual([]);
  });

  it("creates separate nets for disconnected pins", () => {
    const sym1 = makeSymbol("s1", { x: 0, y: 0 }, [
      { id: "p1", name: "A", position: { x: 100, y: 0 } },
    ]);
    const sym2 = makeSymbol("s2", { x: 1000, y: 0 }, [
      { id: "p1", name: "B", position: { x: 100, y: 0 } },
    ]);

    const nets = extractNets([sym1, sym2], [], []);

    expect(nets).toHaveLength(2);
    expect(nets[0]?.pinIds).toContain("s1-p1");
    expect(nets[1]?.pinIds).toContain("s2-p1");
  });

  it("connects two pins with one wire via pin IDs", () => {
    const sym1 = makeSymbol("s1", { x: 0, y: 0 }, [
      { id: "p1", name: "A", position: { x: 100, y: 0 } },
    ]);
    const sym2 = makeSymbol("s2", { x: 500, y: 0 }, [
      { id: "p1", name: "B", position: { x: -100, y: 0 } },
    ]);

    const wire = makeWire(
      "w1",
      [
        { x: 100, y: 0 },
        { x: 400, y: 0 },
      ],
      "s1-p1",
      "s2-p1",
    );

    const nets = extractNets([sym1, sym2], [wire], []);

    expect(nets).toHaveLength(1);
    expect(nets[0]?.pinIds).toContain("s1-p1");
    expect(nets[0]?.pinIds).toContain("s2-p1");
    expect(nets[0]?.wireIds).toContain("w1");
  });

  it("connects chain A→B→C through two wires", () => {
    const symA = makeSymbol("a", { x: 0, y: 0 }, [
      { id: "p1", name: "out", position: { x: 100, y: 0 } },
    ]);
    const symB = makeSymbol("b", { x: 300, y: 0 }, [
      { id: "p1", name: "in", position: { x: -100, y: 0 } },
      { id: "p2", name: "out", position: { x: 100, y: 0 } },
    ]);
    const symC = makeSymbol("c", { x: 600, y: 0 }, [
      { id: "p1", name: "in", position: { x: -100, y: 0 } },
    ]);

    const wire1 = makeWire(
      "w1",
      [
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ],
      "a-p1",
      "b-p1",
    );
    const wire2 = makeWire(
      "w2",
      [
        { x: 400, y: 0 },
        { x: 500, y: 0 },
      ],
      "b-p2",
      "c-p1",
    );

    const nets = extractNets([symA, symB, symC], [wire1, wire2], []);

    // A-B and B-C are separate nets (not directly connected)
    expect(nets).toHaveLength(2);

    const netAB = nets.find((n) => n.pinIds.includes("a-p1"));
    expect(netAB?.pinIds).toContain("b-p1");
    expect(netAB?.pinIds).not.toContain("b-p2");

    const netBC = nets.find((n) => n.pinIds.includes("c-p1"));
    expect(netBC?.pinIds).toContain("b-p2");
  });

  it("connects pins at T-junction (multiple wires at same point)", () => {
    const sym1 = makeSymbol("s1", { x: 0, y: 0 }, [
      { id: "p1", name: "A", position: { x: 100, y: 0 } },
    ]);
    const sym2 = makeSymbol("s2", { x: 400, y: 0 }, [
      { id: "p1", name: "B", position: { x: -100, y: 0 } },
    ]);
    const sym3 = makeSymbol("s3", { x: 200, y: 200 }, [
      { id: "p1", name: "C", position: { x: 0, y: -100 } },
    ]);

    // T-junction at (200, 0)
    const wire1 = makeWire(
      "w1",
      [
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ],
      "s1-p1",
      "",
    );
    const wire2 = makeWire(
      "w2",
      [
        { x: 200, y: 0 },
        { x: 300, y: 0 },
      ],
      "",
      "s2-p1",
    );
    const wire3 = makeWire(
      "w3",
      [
        { x: 200, y: 0 },
        { x: 200, y: 100 },
      ],
      "",
      "s3-p1",
    );

    const nets = extractNets([sym1, sym2, sym3], [wire1, wire2, wire3], []);

    expect(nets).toHaveLength(1);
    expect(nets[0]?.pinIds).toContain("s1-p1");
    expect(nets[0]?.pinIds).toContain("s2-p1");
    expect(nets[0]?.pinIds).toContain("s3-p1");
  });

  it("merges nets with same net label name", () => {
    const sym1 = makeSymbol("s1", { x: 0, y: 0 }, [
      { id: "p1", name: "A", position: { x: 100, y: 0 } },
    ]);
    const sym2 = makeSymbol("s2", { x: 1000, y: 0 }, [
      { id: "p1", name: "B", position: { x: -100, y: 0 } },
    ]);

    // Wires to label positions
    const wire1 = makeWire(
      "w1",
      [
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ],
      "s1-p1",
      "",
    );
    const wire2 = makeWire(
      "w2",
      [
        { x: 900, y: 0 },
        { x: 800, y: 0 },
      ],
      "s2-p1",
      "",
    );

    // Same label name "SDA" on both disconnected wire segments
    const label1 = makeLabel("l1", "SDA", { x: 200, y: 0 });
    const label2 = makeLabel("l2", "SDA", { x: 800, y: 0 });

    const nets = extractNets([sym1, sym2], [wire1, wire2], [label1, label2]);

    expect(nets).toHaveLength(1);
    expect(nets[0]?.name).toBe("SDA");
    expect(nets[0]?.pinIds).toContain("s1-p1");
    expect(nets[0]?.pinIds).toContain("s2-p1");
    expect(nets[0]?.labelIds).toContain("l1");
    expect(nets[0]?.labelIds).toContain("l2");
  });

  it("creates implicit GND net for all GND power symbols", () => {
    const gnd1 = makeSymbol(
      "gnd1",
      { x: 0, y: 0 },
      [{ id: "p1", name: "GND", position: { x: 0, y: -50 } }],
      { componentId: "builtin:gnd:default", reference: "#PWR01" },
    );
    const gnd2 = makeSymbol(
      "gnd2",
      { x: 500, y: 0 },
      [{ id: "p1", name: "GND", position: { x: 0, y: -50 } }],
      { componentId: "builtin:gnd:default", reference: "#PWR02" },
    );

    // No wires connecting them
    const nets = extractNets([gnd1, gnd2], [], []);

    expect(nets).toHaveLength(1);
    expect(nets[0]?.name).toBe("GND");
    expect(nets[0]?.pinIds).toContain("gnd1-p1");
    expect(nets[0]?.pinIds).toContain("gnd2-p1");
  });

  it("creates implicit VCC net for all VCC power symbols", () => {
    const vcc1 = makeSymbol(
      "vcc1",
      { x: 0, y: 0 },
      [{ id: "p1", name: "VCC", position: { x: 0, y: 50 } }],
      { componentId: "builtin:vcc:default", reference: "#PWR03" },
    );
    const vcc2 = makeSymbol(
      "vcc2",
      { x: 500, y: 0 },
      [{ id: "p1", name: "VCC", position: { x: 0, y: 50 } }],
      { componentId: "builtin:vcc:default", reference: "#PWR04" },
    );

    const nets = extractNets([vcc1, vcc2], [], []);

    expect(nets).toHaveLength(1);
    expect(nets[0]?.name).toBe("VCC");
    expect(nets[0]?.pinIds).toContain("vcc1-p1");
    expect(nets[0]?.pinIds).toContain("vcc2-p1");
  });

  it("auto-names nets without explicit labels", () => {
    const sym1 = makeSymbol("s1", { x: 0, y: 0 }, [
      { id: "p1", name: "A", position: { x: 100, y: 0 } },
    ]);
    const sym2 = makeSymbol("s2", { x: 500, y: 0 }, [
      { id: "p1", name: "B", position: { x: -100, y: 0 } },
    ]);

    const wire = makeWire(
      "w1",
      [
        { x: 100, y: 0 },
        { x: 400, y: 0 },
      ],
      "s1-p1",
      "s2-p1",
    );

    const nets = extractNets([sym1, sym2], [wire], []);

    expect(nets).toHaveLength(1);
    expect(nets[0]?.name).toMatch(/^Net_\d+$/);
  });

  it("connects pins by coordinate overlap (wire endpoint at pin position)", () => {
    const sym1 = makeSymbol("s1", { x: 0, y: 0 }, [
      { id: "p1", name: "A", position: { x: 100, y: 0 } },
    ]);
    const sym2 = makeSymbol("s2", { x: 400, y: 0 }, [
      { id: "p1", name: "B", position: { x: -100, y: 0 } },
    ]);

    // Wire endpoints at pin world positions, but no pin ID references
    const wire = makeWire("w1", [
      { x: 100, y: 0 }, // at s1-p1 world position (0+100, 0)
      { x: 300, y: 0 }, // at s2-p1 world position (400-100, 0)
    ]);

    const nets = extractNets([sym1, sym2], [wire], []);

    expect(nets).toHaveLength(1);
    expect(nets[0]?.pinIds).toContain("s1-p1");
    expect(nets[0]?.pinIds).toContain("s2-p1");
  });

  it("keeps pin-id connectivity after rerouted drag geometry changes", () => {
    const sym2 = makeSymbol("s2", { x: 400, y: 0 }, [
      { id: "p1", name: "IN", position: { x: -100, y: 0 } },
      { id: "p2", name: "OUT", position: { x: 100, y: 0 } },
    ]);
    const sym3 = makeSymbol("s3", { x: 900, y: 0 }, [
      { id: "p1", name: "IN", position: { x: -100, y: 0 } },
    ]);

    const beforeReroute = makeWire(
      "w-reroute",
      [
        { x: 500, y: 0 },
        { x: 700, y: 0 },
        { x: 800, y: 0 },
      ],
      "s2-p2",
      "s3-p1",
    );
    const afterReroute = makeWire(
      "w-reroute",
      [
        { x: 635, y: 0 },
        { x: 635, y: -200 },
        { x: 800, y: -200 },
        { x: 800, y: 0 },
      ],
      "s2-p2",
      "s3-p1",
    );

    const netsBefore = extractNets([sym2, sym3], [beforeReroute], []);
    const netsAfter = extractNets([sym2, sym3], [afterReroute], []);

    const beforeNet = netsBefore.find((net) => net.pinIds.includes("s2-p2"));
    const afterNet = netsAfter.find((net) => net.pinIds.includes("s2-p2"));

    expect(beforeNet?.pinIds).toContain("s3-p1");
    expect(afterNet?.pinIds).toContain("s3-p1");
    expect(afterNet?.pinIds).not.toContain("s2-p1");
  });

  it("handles mixed connectivity: wires + net labels + power symbols", () => {
    const resistor = makeSymbol("r1", { x: 200, y: 0 }, [
      { id: "p1", name: "1", position: { x: -100, y: 0 } },
      { id: "p2", name: "2", position: { x: 100, y: 0 } },
    ]);
    const gnd = makeSymbol(
      "gnd1",
      { x: 0, y: 100 },
      [{ id: "p1", name: "GND", position: { x: 0, y: -50 } }],
      { componentId: "builtin:gnd:default" },
    );
    const vcc = makeSymbol(
      "vcc1",
      { x: 400, y: -100 },
      [{ id: "p1", name: "VCC", position: { x: 0, y: 50 } }],
      { componentId: "builtin:vcc:default" },
    );

    // Wire from resistor pin 1 to GND
    const wire1 = makeWire(
      "w1",
      [
        { x: 100, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 50 },
      ],
      "r1-p1",
      "gnd1-p1",
    );
    // Wire from resistor pin 2 to VCC
    const wire2 = makeWire(
      "w2",
      [
        { x: 300, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: -50 },
      ],
      "r1-p2",
      "vcc1-p1",
    );

    const nets = extractNets([resistor, gnd, vcc], [wire1, wire2], []);

    expect(nets).toHaveLength(2);

    const gndNet = nets.find((n) => n.name === "GND");
    expect(gndNet?.pinIds).toContain("gnd1-p1");
    expect(gndNet?.pinIds).toContain("r1-p1");

    const vccNet = nets.find((n) => n.name === "VCC");
    expect(vccNet?.pinIds).toContain("vcc1-p1");
    expect(vccNet?.pinIds).toContain("r1-p2");
  });
});
