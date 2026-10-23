import { describe, expect, test } from "vitest";
import {
  defaultKeepoutToolOptions,
  defaultZoneToolOptions,
  netRefForPick,
  reconcileKeepoutToolOptions,
  reconcileZoneToolOptions,
} from "./area-tool-options";

describe("defaultZoneToolOptions", () => {
  test("picks the ground net by name when one exists", () => {
    const opts = defaultZoneToolOptions({
      activeLayer: "F.Cu",
      netNames: { "net-1": "VCC", "net-2": "GND" },
    });
    expect(opts.layer).toBe("F.Cu");
    expect(opts.net).toEqual({ netId: "net-2", netName: null });
    expect(opts.padConnection).toBe("solid");
  });

  test("falls back to no net when there is no ground net", () => {
    const opts = defaultZoneToolOptions({
      activeLayer: "B.Cu",
      netNames: { "net-1": "VCC" },
    });
    expect(opts.net).toEqual({ netId: null, netName: null });
  });
});

describe("defaultKeepoutToolOptions", () => {
  test("defaults to the active layer and every restriction forbidden", () => {
    const opts = defaultKeepoutToolOptions({ activeLayer: "In1.Cu" });
    expect(opts.layers).toEqual(["In1.Cu"]);
    expect(opts.restrictions).toEqual({
      tracks: true,
      vias: true,
      pads: true,
      copperPour: true,
      footprints: true,
    });
  });
});

describe("netRefForPick", () => {
  const nets = [
    { id: "net-1", name: "VCC" },
    { id: "net-2", name: "" },
    { id: "net-3", name: "Net_3" },
  ];

  test("empty pick means no net", () => {
    expect(netRefForPick(nets, "")).toEqual({ netId: null, netName: null });
  });

  test("a named net persists by id", () => {
    expect(netRefForPick(nets, "net-1")).toEqual({
      netId: "net-1",
      netName: null,
    });
  });

  test("an unnamed net persists by id", () => {
    expect(netRefForPick(nets, "net-2")).toEqual({
      netId: "net-2",
      netName: null,
    });
  });

  test("an auto-named net persists by id", () => {
    expect(netRefForPick(nets, "net-3")).toEqual({
      netId: "net-3",
      netName: null,
    });
  });

  test("a pick that resolves to nothing means no net", () => {
    expect(netRefForPick(nets, "net-missing")).toEqual({
      netId: null,
      netName: null,
    });
  });
});

describe("reconcileZoneToolOptions", () => {
  test("drops a layer no longer on the stackup", () => {
    const opts = reconcileZoneToolOptions(
      { layer: "In2.Cu", net: { netId: null, netName: null }, padConnection: "solid" },
      { layerCount: 2, netNames: {}, activeLayer: "F.Cu" },
    );
    expect(opts.layer).toBe("F.Cu");
  });

  test("keeps a layer still on the stackup", () => {
    const opts = reconcileZoneToolOptions(
      { layer: "B.Cu", net: { netId: null, netName: null }, padConnection: "solid" },
      { layerCount: 2, netNames: {}, activeLayer: "F.Cu" },
    );
    expect(opts.layer).toBe("B.Cu");
  });

  test("clears a named net no longer present", () => {
    const opts = reconcileZoneToolOptions(
      { layer: "F.Cu", net: { netId: null, netName: "GND" }, padConnection: "solid" },
      { layerCount: 2, netNames: { "net-1": "VCC" }, activeLayer: "F.Cu" },
    );
    expect(opts.net).toEqual({ netId: null, netName: null });
  });

  test("keeps a named net still present", () => {
    const opts = reconcileZoneToolOptions(
      { layer: "F.Cu", net: { netId: null, netName: "GND" }, padConnection: "solid" },
      { layerCount: 2, netNames: { "net-1": "GND" }, activeLayer: "F.Cu" },
    );
    expect(opts.net).toEqual({ netId: null, netName: "GND" });
  });

  test("retains an inactive id for repair", () => {
    const opts = reconcileZoneToolOptions(
      { layer: "F.Cu", net: { netId: "net-1", netName: null }, padConnection: "solid" },
      { layerCount: 2, netNames: {}, activeLayer: "F.Cu" },
    );
    expect(opts.net).toEqual({ netId: "net-1", netName: null });
  });

  test("keeps a renamed net's id despite its old name hint", () => {
    const net = { netId: "net-1", netName: "GND" };
    const opts = reconcileZoneToolOptions(
      { layer: "F.Cu", net, padConnection: "solid" },
      { layerCount: 2, netNames: { "net-1": "GROUND" }, activeLayer: "F.Cu" },
    );
    expect(opts.net).toEqual(net);
  });

  test("never rebinds an inactive id through a matching name hint", () => {
    const net = { netId: "retired", netName: "GND" };
    const opts = reconcileZoneToolOptions(
      { layer: "F.Cu", net, padConnection: "solid" },
      { layerCount: 2, netNames: { "net-2": "GND" }, activeLayer: "F.Cu" },
    );
    expect(opts.net).toEqual(net);
  });

  test("keeps the legacy name match only for a null id", () => {
    const net = { netId: null, netName: " gnd " };
    const opts = reconcileZoneToolOptions(
      { layer: "F.Cu", net, padConnection: "solid" },
      { layerCount: 2, netNames: { "net-2": "GND" }, activeLayer: "F.Cu" },
    );
    expect(opts.net).toEqual(net);
  });

  test("keeps an unnamed net whose id still resolves", () => {
    const opts = reconcileZoneToolOptions(
      { layer: "F.Cu", net: { netId: "net-1", netName: null }, padConnection: "solid" },
      { layerCount: 2, netNames: { "net-1": "" }, activeLayer: "F.Cu" },
    );
    expect(opts.net).toEqual({ netId: "net-1", netName: null });
  });

  test("leaves other fields untouched", () => {
    const opts = reconcileZoneToolOptions(
      { layer: "F.Cu", net: { netId: null, netName: null }, padConnection: "thermal" },
      { layerCount: 4, netNames: {}, activeLayer: "F.Cu" },
    );
    expect(opts.padConnection).toBe("thermal");
  });
});

describe("reconcileKeepoutToolOptions", () => {
  test("drops off-stackup layers", () => {
    const opts = reconcileKeepoutToolOptions(
      { layers: ["F.Cu", "In2.Cu"], restrictions: { tracks: true, vias: true, pads: true, copperPour: true, footprints: true } },
      { layerCount: 2, activeLayer: "F.Cu" },
    );
    expect(opts.layers).toEqual(["F.Cu"]);
  });

  test("falls back to the active layer when every layer drops", () => {
    const opts = reconcileKeepoutToolOptions(
      { layers: ["In1.Cu", "In2.Cu"], restrictions: { tracks: true, vias: true, pads: true, copperPour: true, footprints: true } },
      { layerCount: 2, activeLayer: "B.Cu" },
    );
    expect(opts.layers).toEqual(["B.Cu"]);
  });
});
