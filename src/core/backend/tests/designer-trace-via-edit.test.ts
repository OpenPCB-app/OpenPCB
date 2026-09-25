import { afterEach, describe, expect, test } from "bun:test";
import type { DesignerCommand, DesignerSDK } from "../../../sdks";
import {
  bootDesignerRuntime,
  dispatchOk,
  envelope,
  postCommand,
  TEST_SESSION,
} from "./helpers/designer-runtime";

const ADVANCED_VIAS_ENV = "OPENPCB_FEATURE_PCB_ADVANCEDVIAS";

async function dispatch(
  sdk: DesignerSDK,
  designId: string,
  command: DesignerCommand,
) {
  const revision = (await sdk.getPcbProjection(designId))!.revision;
  return sdk.dispatchCommand(designId, envelope(designId, revision, command));
}

async function seedCopper(sdk: DesignerSDK, designId: string) {
  const trace = await dispatchOk(sdk, designId, {
    type: "pcb_add_trace",
    layer: "F.Cu",
    pointsNm: [
      { x: 0, y: 0 },
      { x: 10_000_000, y: 0 },
    ],
    widthMm: 0.25,
    netId: null,
    netClassId: "default",
    segmentMode: "manhattan-90",
  });
  const via = await dispatchOk(sdk, designId, {
    type: "pcb_add_via",
    centerMm: { x: 20, y: 10 },
    netId: null,
    netClassId: "default",
  });
  return { traceId: trace.createdEntityId!, viaId: via.createdEntityId! };
}

async function traceOf(sdk: DesignerSDK, designId: string, id: string) {
  return (await sdk.getPcbProjection(designId))!.traces.find((t) => t.id === id)!;
}

async function viaOf(sdk: DesignerSDK, designId: string, id: string) {
  return (await sdk.getPcbProjection(designId))!.vias.find((v) => v.id === id)!;
}

afterEach(() => {
  delete process.env[ADVANCED_VIAS_ENV];
});

describe("pcb_update_trace (T-174)", () => {
  test("width and layer edits persist and undo in one step", async () => {
    const { sdk } = await bootDesignerRuntime("trace-edit");
    const design = await sdk.createDesign({ name: "Trace edit" });
    const { traceId } = await seedCopper(sdk, design.id);

    await dispatchOk(sdk, design.id, {
      type: "pcb_update_trace",
      traceId,
      widthMm: 0.5,
      layer: "B.Cu",
    });
    const edited = await traceOf(sdk, design.id, traceId);
    expect(edited.widthMm).toBe(0.5);
    expect(edited.layer).toBe("B.Cu");
    expect(edited.pointsNm).toHaveLength(2);

    await sdk.undo(design.id, TEST_SESSION);
    const undone = await traceOf(sdk, design.id, traceId);
    expect(undone.widthMm).toBe(0.25);
    expect(undone.layer).toBe("F.Cu");
  });

  test("a layer off the stackup, an unknown trace and a too-thin width are refused", async () => {
    const { sdk } = await bootDesignerRuntime("trace-edit-refuse");
    const design = await sdk.createDesign({ name: "Trace refuse" });
    const { traceId } = await seedCopper(sdk, design.id);

    const offStack = await dispatch(sdk, design.id, {
      type: "pcb_update_trace",
      traceId,
      layer: "In1.Cu",
    });
    expect(offStack.ok ? null : offStack.code).toBe("INVALID_PCB_TRACE");

    const missing = await dispatch(sdk, design.id, {
      type: "pcb_update_trace",
      traceId: "nope",
      widthMm: 0.3,
    });
    expect(missing.ok ? null : missing.code).toBe("PCB_TRACE_NOT_FOUND");

    // Below the board's 0.2 mm minimum: TRACE_WIDTH_MIN is in the refuse set.
    const thin = await dispatch(sdk, design.id, {
      type: "pcb_update_trace",
      traceId,
      widthMm: 0.05,
    });
    expect(thin.ok ? null : thin.code).toBe("PCB_COPPER_ILLEGAL");
    expect((await traceOf(sdk, design.id, traceId)).widthMm).toBe(0.25);
  });
});

describe("pcb_update_via (T-174)", () => {
  test("size and tenting edits persist and undo in one step", async () => {
    const { sdk } = await bootDesignerRuntime("via-edit");
    const design = await sdk.createDesign({ name: "Via edit" });
    const { viaId } = await seedCopper(sdk, design.id);

    await dispatchOk(sdk, design.id, {
      type: "pcb_update_via",
      viaId,
      diameterMm: 1.0,
      drillMm: 0.5,
      protection: "none",
    });
    const edited = await viaOf(sdk, design.id, viaId);
    expect([edited.diameterMm, edited.drillMm, edited.protection]).toEqual([
      1.0,
      0.5,
      "none",
    ]);

    await sdk.undo(design.id, TEST_SESSION);
    const undone = await viaOf(sdk, design.id, viaId);
    expect([undone.diameterMm, undone.drillMm, undone.protection]).toEqual([
      0.8,
      0.4,
      "tented",
    ]);
  });

  test("sizes the insert gate would refuse are refused", async () => {
    const { sdk } = await bootDesignerRuntime("via-edit-refuse");
    const design = await sdk.createDesign({ name: "Via refuse" });
    const { viaId } = await seedCopper(sdk, design.id);
    for (const patch of [
      { drillMm: 0.8 },
      { diameterMm: 0.3, drillMm: 0.2 },
      { drillMm: 0.1 },
    ]) {
      const result = await dispatch(sdk, design.id, {
        type: "pcb_update_via",
        viaId,
        ...patch,
      });
      expect(result.ok ? null : result.code).toBe("INVALID_PCB_VIA");
    }
    expect((await viaOf(sdk, design.id, viaId)).diameterMm).toBe(0.8);
  });

  test("viaType 'through' converts a blind via to the full barrel; a blind via stays resizable without advancedVias", async () => {
    const { sdk } = await bootDesignerRuntime("via-convert");
    const design = await sdk.createDesign({ name: "Via convert" });
    // A 2-layer board has no legal blind span, so the gate would refuse this
    // one; store it the way the KiCad importer does, unjudged.
    const blind = await dispatchOk(sdk, design.id, {
      type: "pcb_add_via",
      centerMm: { x: 5, y: 5 },
      netId: null,
      netClassId: "default",
      viaType: "blind",
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      legality: "off",
    });
    const viaId = blind.createdEntityId!;

    process.env[ADVANCED_VIAS_ENV] = "0";
    // Untouched type + span: no flag needed.
    await dispatchOk(sdk, design.id, {
      type: "pcb_update_via",
      viaId,
      diameterMm: 0.9,
      legality: "report",
    });
    expect((await viaOf(sdk, design.id, viaId)).viaType).toBe("blind");
    // Setting a non-through type needs the flag, as on insert.
    const refused = await dispatch(sdk, design.id, {
      type: "pcb_update_via",
      viaId,
      viaType: "micro",
      legality: "report",
    });
    expect(refused.ok ? null : refused.code).toBe("INVALID_PCB_VIA");
    // Converting TO through never does.
    await dispatchOk(sdk, design.id, {
      type: "pcb_update_via",
      viaId,
      viaType: "through",
    });
    const through = await viaOf(sdk, design.id, viaId);
    expect([through.viaType, through.fromLayer, through.toLayer]).toEqual([
      "through",
      "F.Cu",
      "B.Cu",
    ]);
  });

  test("the HTTP parser forwards every field and refuses empty or malformed patches", async () => {
    const { sdk, server } = await bootDesignerRuntime("trace-via-http");
    const design = await sdk.createDesign({ name: "Edit http" });
    const { traceId, viaId } = await seedCopper(sdk, design.id);
    const post = async (command: unknown) =>
      postCommand(server, design.id, {
        commandId: crypto.randomUUID(),
        sessionId: TEST_SESSION,
        aggregateId: design.id,
        baseRevision: (await sdk.getPcbProjection(design.id))!.revision,
        issuedAt: Date.now(),
        command,
      });

    for (const bad of [
      { type: "pcb_update_trace", traceId },
      { type: "pcb_update_trace", traceId, widthMm: 0 },
      { type: "pcb_update_trace", traceId, layer: "Top" },
      { type: "pcb_update_via", viaId },
      { type: "pcb_update_via", viaId, viaType: "stacked" },
      { type: "pcb_update_via", viaId, protection: "gold" },
      { type: "pcb_update_via", viaId, drillMm: -1 },
    ]) {
      expect((await post(bad)).status).toBe(400);
    }

    const okTrace = await post({
      type: "pcb_update_trace",
      traceId,
      widthMm: 0.3,
      legality: "report",
    });
    expect(okTrace.status).toBe(200);
    expect((await traceOf(sdk, design.id, traceId)).widthMm).toBe(0.3);
    const okVia = await post({
      type: "pcb_update_via",
      viaId,
      protection: "filled",
    });
    expect(okVia.status).toBe(200);
    expect((await viaOf(sdk, design.id, viaId)).protection).toBe("filled");
  });
});
