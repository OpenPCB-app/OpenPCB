import { describe, expect, test } from "bun:test";
import type { DesignerBatchableCommand, DesignerCommand, DesignerDerivedNet } from "../../../sdks/designer";
import { detectNetMerge, getNetMergePolicy, isNetMergeGatedCommand, isNetMergeGatedDispatch } from "../../../modules/designer/backend/net-merge-guard";

const naming: DesignerBatchableCommand[] = [
  { type: "upsert_label", text: "A", positionNm: { x: 0, y: 0 } },
  { type: "place_gnd_port", positionNm: { x: 0, y: 0 } },
  { type: "place_pwr_port", railText: "A", positionNm: { x: 0, y: 0 } },
  { type: "place_net_portal", portalText: "A", positionNm: { x: 0, y: 0 } },
  { type: "update_primitive_text", primitiveId: "primitive", text: "A" },
];
const geometry: DesignerCommand[] = [
  { type: "place_part", componentId: "component", positionNm: { x: 0, y: 0 } },
  { type: "duplicate_part", partId: "part", positionNm: { x: 0, y: 0 } },
  { type: "move_part", partId: "part", positionNm: { x: 0, y: 0 } },
  { type: "rotate_part", partId: "part", rotationDeg: 90 }, { type: "mirror_part", partId: "part", mirrored: true },
  { type: "move_primitive", primitiveId: "primitive", positionNm: { x: 0, y: 0 } },
  { type: "rotate_primitive", primitiveId: "primitive", rotationDeg: 90 },
  { type: "update_wire_geometry", wireId: "wire", pointsNm: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
  { type: "auto_arrange_schematic", scope: "all" },
];
const intentional: DesignerCommand[] = [
  { type: "create_wire", sourcePinId: "a", targetPinId: "b" },
  { type: "create_wire_junction", sourcePinId: "a", wireId: "wire", targetPointNm: { x: 0, y: 0 } },
  { type: "refresh_part_footprint", partIds: ["part"] },
  { type: "set_pin_electrical_intent", pinId: "pin", intent: "no_connect" },
  { type: "update_part_properties", partId: "part", value: "unchanged endpoints" },
  { type: "delete_entity", entityId: "wire", entityKind: "wire" },
];
function net(id: string, name: string, autoNamed: boolean): DesignerDerivedNet {
  return { id, name, autoNamed, pinIds: [`${id}:a`, `${id}:b`], wireIds: [], labelIds: [], primitiveIds: [] };
}

describe("merge gate dispatch policies", () => {
  for (const [policy, commands] of [["naming", naming], ["geometry", geometry]] as const) {
    test.each(commands)(`${policy} command %j requires consent unless confirmed`, (command) => {
      expect(getNetMergePolicy(command)).toBe(policy); expect(isNetMergeGatedCommand(command)).toBe(true);
      expect(isNetMergeGatedDispatch(command)).toBe(true);
      expect(getNetMergePolicy({ ...command, confirmMerge: false } as DesignerCommand)).toBe(policy);
      expect(getNetMergePolicy({ ...command, confirmMerge: true } as DesignerCommand)).toBeNull();
    });
  }
  test.each(intentional)("intentional or neutral command %j is not gated", (command) => {
    expect(getNetMergePolicy(command)).toBeNull(); expect(isNetMergeGatedCommand(command)).toBe(false);
  });

  test("mixed batches choose the broadest unconfirmed policy, independent of step order", () => {
    const move: DesignerBatchableCommand = { type: "move_part", partId: "part", positionNm: { x: 0, y: 0 } };
    for (const commands of [[move, naming[0]!], [naming[0]!, move]]) expect(getNetMergePolicy({ type: "batch_commands", commands })).toBe("naming");
    expect(getNetMergePolicy({ type: "batch_commands", commands: [move] })).toBe("geometry");
    expect(getNetMergePolicy({ type: "batch_commands", commands: [move, { ...naming[0]!, confirmMerge: true } as DesignerBatchableCommand] })).toBe("geometry");
    expect(getNetMergePolicy({ type: "batch_commands", commands: [{ ...move, confirmMerge: true }, naming[0]!] })).toBe("naming");
    expect(getNetMergePolicy({ type: "batch_commands", commands: [{ ...move, confirmMerge: true }] })).toBeNull();
    expect(getNetMergePolicy({ type: "batch_commands", commands: [intentional[0]! as DesignerBatchableCommand] })).toBeNull();
  });

  test("geometry ignores two anonymous multipin predecessors while naming retains protection", () => {
    const before = [net("one", "Net_1", true), net("two", "Net_2", true)];
    const after = [{ ...before[0]!, pinIds: before.flatMap(row => row.pinIds) }];
    expect(detectNetMerge(before, after, "geometry")).toBeNull();
    expect(detectNetMerge(before, after)).toEqual({ nets: [{ name: null, pinCount: 2 }, { name: null, pinCount: 2 }] });
  });

  test("autoNamed is authoritative for literal Net_5 and collision-suffixed generated names", () => {
    for (const policy of ["naming", "geometry"] as const) {
      const explicit = [net("one", "Net_5", false), net("two", "GND", false)];
      expect(detectNetMerge(explicit, [{ ...explicit[0]!, pinIds: explicit.flatMap(row => row.pinIds) }], policy)?.nets)
        .toEqual([{ name: "Net_5", pinCount: 2 }, { name: "GND", pinCount: 2 }]);
    }
    const generated = [net("one", "Net_5_2", true), net("two", "unconnected-(U1-Pin)", true)];
    expect(detectNetMerge(generated, [{ ...generated[0]!, pinIds: generated.flatMap(row => row.pinIds) }], "geometry")).toBeNull();
    const mixed = [net("one", "VCC", false), net("two", "Net_2", true)];
    expect(detectNetMerge(mixed, [{ ...mixed[0]!, pinIds: mixed.flatMap(row => row.pinIds) }], "geometry")).toBeNull();
  });
});
