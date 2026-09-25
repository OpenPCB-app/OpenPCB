import { describe, expect, test } from "bun:test";
import type { DesignerSDK, PcbNetClass } from "../../../sdks";
import {
  bootDesignerRuntime,
  dispatchOk,
  envelope,
  TEST_SESSION,
} from "./helpers/designer-runtime";

async function board(sdk: DesignerSDK, designId: string) {
  return (await sdk.getPcbProjection(designId))!.board;
}

async function saveClasses(
  sdk: DesignerSDK,
  designId: string,
  netClasses: unknown[],
  perNetClassAssignments?: Record<string, string>,
) {
  const revision = (await sdk.getPcbProjection(designId))!.revision;
  return sdk.dispatchCommand(
    designId,
    envelope(designId, revision, {
      type: "pcb_set_design_rules",
      netClasses: netClasses as PcbNetClass[],
      ...(perNetClassAssignments ? { perNetClassAssignments } : {}),
    }),
  );
}

describe("net class management through pcb_set_design_rules (T-162)", () => {
  test("add + rename + delete in one save; a deleted class releases its nets and copper; one undo restores it", async () => {
    const { sdk } = await bootDesignerRuntime("netclass-manage");
    const design = await sdk.createDesign({ name: "Net classes" });
    const [defaultClass, power, gnd] = (await board(sdk, design.id)).netClasses;
    expect(gnd?.id).toBe("gnd");
    // Park an assignment and a trace on the class about to be deleted.
    let result = await saveClasses(
      sdk,
      design.id,
      [defaultClass, power, gnd],
      { "net-a": "gnd" },
    );
    expect(result.ok).toBe(true);
    const trace = await dispatchOk(sdk, design.id, {
      type: "pcb_add_trace",
      layer: "F.Cu",
      pointsNm: [
        { x: 0, y: 0 },
        { x: 5_000_000, y: 0 },
      ],
      widthMm: 0.4,
      netId: null,
      netClassId: "gnd",
      segmentMode: "manhattan-90",
    });

    result = await saveClasses(sdk, design.id, [
      defaultClass,
      { ...power!, name: "Power rail" },
      {
        id: "high-current",
        name: "HighCurrent",
        traceWidthMm: 1.0,
        clearanceMm: 0.3,
        viaDiameterMm: 1.0,
        viaDrillMm: 0.5,
        color: "#f59e0b",
        defaultViaProtection: "tented",
      },
    ]);
    expect(result.ok).toBe(true);

    const saved = await board(sdk, design.id);
    expect(saved.netClasses.map((c) => [c.id, c.name])).toEqual([
      ["default", "Default"],
      ["power", "Power rail"],
      ["high-current", "HighCurrent"],
    ]);
    expect(saved.netClasses[2]?.viaDiameterMm).toBe(1.0);
    expect(saved.netClasses[2]?.viaDrillMm).toBe(0.5);
    expect(saved.perNetClassAssignments?.["net-a"]).toBeUndefined();
    const pcb = (await sdk.getPcbProjection(design.id))!;
    expect(
      pcb.traces.find((t) => t.id === trace.createdEntityId)?.netClassId,
    ).toBe("default");

    await sdk.undo(design.id, TEST_SESSION);
    const restored = (await sdk.getPcbProjection(design.id))!;
    expect(restored.board.netClasses.map((c) => c.id)).toEqual([
      "default",
      "power",
      "gnd",
    ]);
    expect(restored.board.perNetClassAssignments?.["net-a"]).toBe("gnd");
    expect(
      restored.traces.find((t) => t.id === trace.createdEntityId)?.netClassId,
    ).toBe("gnd");
  });

  test("an invalid class table is refused whole and nothing is persisted", async () => {
    const { sdk } = await bootDesignerRuntime("netclass-invalid");
    const design = await sdk.createDesign({ name: "Invalid classes" });
    const classes = (await board(sdk, design.id)).netClasses;
    const [defaultClass, power] = classes;
    const invalidTables: unknown[][] = [
      [],
      [defaultClass, { ...power!, name: "default" }],
      [defaultClass, { ...power!, id: "default" }],
      [defaultClass, { ...power!, name: "  " }],
      [defaultClass, { ...power!, id: " power" }],
      [defaultClass, { ...power!, viaDrillMm: 0.8 }],
      [defaultClass, { ...power!, traceWidthMm: 0 }],
      [defaultClass, { ...power!, clearanceMm: -0.1 }],
      [defaultClass, { ...power!, viaDiameterMm: "wide" }],
      [power, defaultClass],
      [power],
    ];
    for (const table of invalidTables) {
      const result = await saveClasses(sdk, design.id, table);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("INVALID_PCB_BOARD_SETTINGS");
    }
    expect((await board(sdk, design.id)).netClasses).toEqual(classes);
  });
});
