import { describe, expect, test } from "bun:test";
import { buildDrcContext } from "../../../shared/drc/drc-context";
import { runDrc } from "../../../shared/drc/drc-engine";
import { createRuleResolver } from "../../../shared/drc/rule-resolver";
import { defaultNetClassId, effectiveNetClassId, resolveNetClassId } from "../../../shared/pcb-areas/net-class-resolver";
import { board, projection, trace } from "./helpers/drc-fixtures";

const SPECIAL_IDS = ["constructor", "__proto__", "toString"];

function inherited(entries: Record<string, string>): Record<string, string> {
  return Object.create(entries) as Record<string, string>;
}

describe("net identity dictionaries use own keys", () => {
  test.each(SPECIAL_IDS)("absent name for %s reports orphan copper instead of crashing", (netId) => {
    const result = runDrc(projection({ traces: [trace("trace", netId, [[0, 0], [1, 0]])] }));
    expect(result.violations.filter((row) => row.code === "NET_ORPHANED_COPPER")).toMatchObject([{
      severity: "error", anchors: [{ kind: "trace", traceId: "trace" }],
    }]);
  });

  test.each(SPECIAL_IDS)("own name for %s remains active and drives name-pattern class selection", (netId) => {
    const names = Object.fromEntries([[netId, "VCC"]]);
    const scene = projection({ netNames: names, traces: [trace("trace", netId, [[0, 0], [1, 0]])] });
    const context = buildDrcContext(scene), result = runDrc(scene);
    expect(Object.getPrototypeOf(context.netNames)).toBeNull();
    expect(Object.keys(context.netNames)).toEqual([netId]);
    expect(context.netNames[netId]).toBe("VCC");
    expect(context.resolver.netClassIdOf(netId)).toBe("power");
    expect(result.violations.filter((row) => row.code === "NET_ORPHANED_COPPER")).toEqual([]);
    expect(result.violations.some((row) => row.code === "NETCLASS_TRACE_WIDTH")).toBe(true);
    expect(Object.getPrototypeOf(names)).toBe(Object.prototype);
    expect(names[netId]).toBe("VCC");
  });

  test("inherited named properties are neither active nor class-pattern intent", () => {
    const names = inherited({ ghost: "VCC" });
    const scene = projection({ netNames: names, traces: [trace("trace", "ghost", [[0, 0], [1, 0]])] });
    const context = buildDrcContext(scene), result = runDrc(scene);
    expect(Object.keys(context.netNames)).toEqual([]);
    expect(context.resolver.netClassIdOf("ghost")).toBe(defaultNetClassId(scene.board.netClasses));
    expect(result.violations.filter((row) => row.code === "NET_ORPHANED_COPPER")).toHaveLength(1);
    expect(result.violations.filter((row) => row.code === "NETCLASS_TRACE_WIDTH")).toEqual([]);
    expect(names.ghost).toBe("VCC");
  });

  test("public resolver independently rejects inherited net-name entries", () => {
    const settings = board(), options = { validCopperLayers: ["F.Cu", "B.Cu"] as const };
    const absent = createRuleResolver(settings, {}, options);
    for (const netId of SPECIAL_IDS) expect(absent.netClassIdOf(netId)).toBe(defaultNetClassId(settings.netClasses));
    expect(createRuleResolver(settings, inherited({ ghost: "VCC" }), options).netClassIdOf("ghost"))
      .toBe(defaultNetClassId(settings.netClasses));
    expect(createRuleResolver(settings, Object.fromEntries([["constructor", "GND"]]), options).netClassIdOf("constructor"))
      .toBe("gnd");
  });

  test.each(SPECIAL_IDS)("only own %s assignment selects or upgrades a class", (netId) => {
    const settings = board(), defaultId = defaultNetClassId(settings.netClasses);
    const own = Object.fromEntries([[netId, "power"]]), inheritedMap = inherited(own);
    expect(resolveNetClassId("SIGNAL", settings.netClasses, inheritedMap, netId)).toBe(defaultId);
    expect(resolveNetClassId("SIGNAL", settings.netClasses, own, netId)).toBe("power");
    expect(effectiveNetClassId({ ...settings, perNetClassAssignments: inheritedMap }, netId, defaultId)).toBe(defaultId);
    expect(effectiveNetClassId({ ...settings, perNetClassAssignments: own }, netId, defaultId)).toBe("power");
    expect(effectiveNetClassId({ ...settings, perNetClassAssignments: own }, netId, "gnd")).toBe("gnd");
    expect(resolveNetClassId("GND", settings.netClasses, Object.fromEntries([[netId, "missing-class"]]), netId)).toBe("gnd");
  });

  test.each(SPECIAL_IDS)("inherited %s assignment does not enforce the default class", (netId) => {
    const assignments = Object.fromEntries([[netId, "power"]]), names = Object.fromEntries([[netId, "SIGNAL"]]);
    const scene = projection({ netNames: names, board: board({ perNetClassAssignments: inherited(assignments) }),
      traces: [trace("trace", netId, [[0, 0], [1, 0]], { widthMm: 0.1 })] });
    expect(runDrc(scene).violations.filter((row) => row.code === "NETCLASS_TRACE_WIDTH")).toEqual([]);
    scene.board.perNetClassAssignments = assignments;
    expect(runDrc(scene).violations.filter((row) => row.code === "NETCLASS_TRACE_WIDTH")).toHaveLength(1);
  });
});
