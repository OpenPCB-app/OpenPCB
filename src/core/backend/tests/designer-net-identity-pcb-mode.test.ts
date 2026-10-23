import { describe, expect, test } from "bun:test";
import type { DesignerDerivedNet, PcbZone } from "../../../sdks/designer";
import { bindLegacyNetNames } from "../../../modules/designer/backend/net-identity/legacy-mode";
import { assemblePcbLegalityInput, type PcbLegalityRows } from "../../../modules/designer/backend/pcb/pcb-projection";
import { detectNetMerge } from "../../../modules/designer/backend/net-merge-guard";
import { board, pad, placement, trace, via } from "./helpers/drc-fixtures";
import { ercPart, ercPin, ercProjection } from "./helpers/erc-fixtures";

function net(id: string, name: string, extra: Partial<DesignerDerivedNet> = {}): DesignerDerivedNet {
  return { id, name, pinIds: [], wireIds: [], labelIds: [], primitiveIds: [], ...extra };
}
function zone(id: string, netName: string | null, extra: Partial<PcbZone> = {}): PcbZone {
  return { id, name: null, enabled: true, lockedAt: null, layer: "F.Cu", netId: null, netName,
    region: { kind: "board" }, priority: 0, ...extra };
}
function rows(extra: Partial<PcbLegalityRows> = {}): PcbLegalityRows {
  return { schematic: ercProjection(), board: board(), placements: [], traces: [], vias: [],
    freeHoles: [], freePads: [], zones: [], keepouts: [], ...extra };
}

describe("legacy-only PCB name binding", () => {
  test("legacy first-match trace/via binding and ambiguous zone warnings stay exact", () => {
    const input = rows({
      schematic: ercProjection({ nets: [net("first", " VCC "), net("second", "vcc"), net("auto", "Net_5"), net("signal", "SIG")] }),
      traces: [
        { ...trace("hint", null, [[0, 0], [1, 0]]), netName: " vCc " },
        { ...trace("stale", "retired", [[0, 0], [1, 0]]), netName: "SIG" },
        { ...trace("unknown", null, [[0, 0], [1, 0]]), netName: "missing" },
        { ...trace("auto", null, [[0, 0], [1, 0]]), netName: "Net_5" },
      ],
      vias: [{ ...via("hint"), netName: "VCC" }, { ...via("stale", { netId: "retired" }), netName: "SIG" }],
      zones: [zone("ambiguous", " vCc "), zone("disabled", "VCC", { enabled: false }),
        zone("signal", " sig "), zone("stale", "SIG", { netId: "retired" }), zone("unknown", "missing")],
    });
    const before = JSON.stringify(input);
    const result = assemblePcbLegalityInput(input, "legacy");
    expect(result.traces.map((entity) => entity.netId)).toEqual(["first", "retired", null, "auto"]);
    expect(result.vias.map((entity) => entity.netId)).toEqual(["first", "retired"]);
    expect(result.zones.map((entity) => entity.netId)).toEqual([null, null, "signal", "retired", null]);
    expect(result.warnings).toEqual([
      'zone_net_ambiguous: Zone ambiguous net " vCc " matches more than one schematic net.',
      'zone_net_ambiguous: Zone disabled net "VCC" matches more than one schematic net.',
    ]);
    expect([...result.ambiguousZoneIds]).toEqual(["ambiguous", "disabled"]);
    const bound = bindLegacyNetNames(input.schematic, input);
    expect({ traces: result.traces, vias: result.vias, zones: result.zones, warnings: result.warnings,
      ambiguousZoneIds: result.ambiguousZoneIds }).toEqual(bound);
    expect(result.traces[1]).toBe(input.traces[1]);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("durable mode passes stale ids and name hints through, including disabled zones", () => {
    const input = rows({
      schematic: ercProjection({ nets: [net("live", "SIG"), net("other", "sig")] }),
      traces: [{ ...trace("hint", null, [[0, 0], [1, 0]]), netName: "SIG" },
        { ...trace("stale", "retired", [[0, 0], [1, 0]]), netName: "SIG" }],
      vias: [{ ...via("hint"), netName: "SIG" }, { ...via("stale", { netId: "retired" }), netName: "SIG" }],
      zones: [zone("hint", "SIG"), zone("stale", "SIG", { netId: "retired" }), zone("disabled", "SIG", { enabled: false })],
    });
    const before = JSON.stringify(input);
    const result = assemblePcbLegalityInput(input, "durable");
    expect(result.traces).toBe(input.traces); expect(result.vias).toBe(input.vias); expect(result.zones).toBe(input.zones);
    expect(result.warnings).toEqual([]); expect(result.ambiguousZoneIds.size).toBe(0);
    expect(result.netNames).toEqual({ live: "SIG", other: "sig" });
    expect(JSON.stringify(input)).toBe(before);
  });

  test("pad correlation and its warnings stay identical across modes", () => {
    const input = rows({
      schematic: ercProjection({ parts: [ercPart([ercPin("1", "passive")])],
        nets: [net("live", "SIG", { pinIds: ["1", "unknown"] })] }),
      placements: [placement("part", { pads: [pad("1", { x: 0, y: 0 }, 1, 1)] })],
    });
    const legacy = assemblePcbLegalityInput(input, "legacy"), durable = assemblePcbLegalityInput(input, "durable");
    expect(legacy.padNets).toEqual({ "part|1": "live" });
    expect(durable.padNets).toEqual(legacy.padNets);
    expect(durable.netNames).toEqual(legacy.netNames);
    expect(durable.warnings).toEqual(["WARN: net live references unknown pin unknown"]);
    expect(legacy.warnings).toEqual(durable.warnings);
  });

  test("missing schematic leaves hints unbound and does not mutate rows", () => {
    const input = rows({ schematic: null, traces: [{ ...trace("hint", null, [[0, 0], [1, 0]]), netName: "SIG" }], zones: [zone("hint", "SIG")] });
    const before = JSON.stringify(input);
    for (const mode of ["legacy", "durable"] as const) {
      const result = assemblePcbLegalityInput(input, mode);
      expect(result.traces[0]).toBe(input.traces[0]); expect(result.zones[0]).toBe(input.zones[0]);
      expect(result.netNames).toEqual({}); expect(result.padNets).toEqual({}); expect(result.warnings).toEqual([]);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  test("an omitted mode is rejected rather than silently choosing a binding policy", () => {
    expect(() => Reflect.apply(assemblePcbLegalityInput, undefined, [rows()])).toThrow("PCB identity mode must be legacy or durable");
  });
});

describe("merge guard naming metadata", () => {
  test("explicit literal Net_5 remains named when durable metadata says so", () => {
    const before = [net("one", "Net_5", { autoNamed: false, pinIds: ["a"] }), net("two", "SIG", { autoNamed: false, pinIds: ["b"] })];
    expect(detectNetMerge(before, [net("one", "Net_5", { pinIds: ["a", "b"] })])).toEqual({
      nets: [{ name: "Net_5", pinCount: 1 }, { name: "SIG", pinCount: 1 }],
    });
  });

  test.each(["Net_5_1", "unconnected-(U1-1)"])("generated %s is anonymous despite display spelling", (name) => {
    const before = [net("one", name, { autoNamed: true, pinIds: ["a"] }), net("two", "SIG", { autoNamed: false, pinIds: ["b"] })];
    expect(detectNetMerge(before, [net("two", "SIG", { pinIds: ["a", "b"] })])).toBeNull();
  });

  test("legacy metadata absence retains the Net_n regex policy", () => {
    const before = [net("one", "Net_5", { pinIds: ["a"] }), net("two", "SIG", { pinIds: ["b"] })];
    expect(detectNetMerge(before, [net("two", "SIG", { pinIds: ["a", "b"] })])).toBeNull();
  });
});
