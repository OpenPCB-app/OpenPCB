import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerSDK,
  PcbCopperLayerId,
  PcbTraceSegmentMode,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createRuntime() {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return { moduleRuntime, server };
}

function envelope(
  designId: string,
  commandId: string,
  sessionId: string,
  baseRevision: number | null,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  return {
    commandId,
    sessionId,
    aggregateId: designId,
    baseRevision,
    issuedAt: Date.now(),
    command,
  };
}

const SESSION = "designer-pcb-session";

async function defaultNetClassId(
  designerSdk: DesignerSDK,
  designId: string,
): Promise<string> {
  const proj = await designerSdk.getPcbProjection(designId);
  expect(proj).toBeTruthy();
  const cls = proj!.board.netClasses[0];
  expect(cls).toBeTruthy();
  return cls!.id;
}

describe("designer PCB traces (Phase 1)", () => {
  test("adds a 90° trace and returns it on the projection", async () => {
    isolateTestDb("traces-add-90");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Traces 90" });
    const netClassId = await defaultNetClassId(sdk, design.id);

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add-trace-90", SESSION, 0, {
        type: "pcb_add_trace",
        layer: "F.Cu" as PcbCopperLayerId,
        pointsNm: [
          { x: 0, y: 0 },
          { x: 5_000_000, y: 0 },
          { x: 5_000_000, y: 3_000_000 },
        ],
        widthMm: 0.25,
        netId: null,
        netClassId,
        segmentMode: "manhattan-90" as PcbTraceSegmentMode,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdEntityId).toBeTruthy();

    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.traces.length).toBe(1);
    expect(proj?.traces[0]?.layer).toBe("F.Cu");
    expect(proj?.traces[0]?.widthMm).toBe(0.25);
    expect(proj?.traces[0]?.pointsNm.length).toBe(3);
  });

  test("adds a 45° trace (diagonal segment allowed)", async () => {
    isolateTestDb("traces-add-45");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Traces 45" });
    const netClassId = await defaultNetClassId(sdk, design.id);

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add-trace-45", SESSION, 0, {
        type: "pcb_add_trace",
        layer: "F.Cu",
        // 45° diagonal: |Δx| = |Δy| = 2_000_000
        pointsNm: [
          { x: 0, y: 0 },
          { x: 2_000_000, y: 2_000_000 },
          { x: 5_000_000, y: 2_000_000 },
        ],
        widthMm: 0.2,
        netId: null,
        netClassId,
        segmentMode: "manhattan-45",
      }),
    );

    expect(result.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.traces[0]?.segmentMode).toBe("manhattan-45");
  });

  test("rejects non-Manhattan path under 90° mode", async () => {
    isolateTestDb("traces-reject-90");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Traces Reject 90" });
    const netClassId = await defaultNetClassId(sdk, design.id);

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-bad-90", SESSION, 0, {
        type: "pcb_add_trace",
        layer: "F.Cu",
        pointsNm: [
          { x: 0, y: 0 },
          { x: 1_000_000, y: 2_000_000 }, // diagonal not allowed in 90°
        ],
        widthMm: 0.25,
        netId: null,
        netClassId,
        segmentMode: "manhattan-90",
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_PCB_TRACE");
  });

  test("rejects unknown net class", async () => {
    isolateTestDb("traces-bad-class");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Traces Bad Class" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-bad-class", SESSION, 0, {
        type: "pcb_add_trace",
        layer: "F.Cu",
        pointsNm: [
          { x: 0, y: 0 },
          { x: 1_000_000, y: 0 },
        ],
        widthMm: 0.25,
        netId: null,
        netClassId: "does-not-exist",
        segmentMode: "manhattan-90",
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PCB_NET_CLASS_NOT_FOUND");
  });

  test("delete trace removes it from projection", async () => {
    isolateTestDb("traces-delete");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Traces Delete" });
    const netClassId = await defaultNetClassId(sdk, design.id);

    const addResult = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add-trace-del", SESSION, 0, {
        type: "pcb_add_trace",
        layer: "F.Cu",
        pointsNm: [
          { x: 0, y: 0 },
          { x: 1_000_000, y: 0 },
        ],
        widthMm: 0.25,
        netId: null,
        netClassId,
        segmentMode: "manhattan-90",
      }),
    );
    expect(addResult.ok).toBe(true);
    const traceId = addResult.ok ? addResult.createdEntityId : null;
    expect(traceId).toBeTruthy();

    const delResult = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-del-trace", SESSION, 1, {
        type: "pcb_delete_trace",
        traceId: traceId!,
      }),
    );
    expect(delResult.ok).toBe(true);

    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.traces.length).toBe(0);
  });

  test("undo / redo of trace add", async () => {
    isolateTestDb("traces-undo");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Traces Undo" });
    const netClassId = await defaultNetClassId(sdk, design.id);

    const addResult = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add-trace-undo", SESSION, 0, {
        type: "pcb_add_trace",
        layer: "F.Cu",
        pointsNm: [
          { x: 0, y: 0 },
          { x: 1_000_000, y: 0 },
        ],
        widthMm: 0.25,
        netId: null,
        netClassId,
        segmentMode: "manhattan-90",
      }),
    );
    expect(addResult.ok).toBe(true);

    const projAfterAdd = await sdk.getPcbProjection(design.id);
    expect(projAfterAdd?.traces.length).toBe(1);

    const undo = await sdk.undo(design.id, SESSION);
    expect(undo.ok).toBe(true);
    const projAfterUndo = await sdk.getPcbProjection(design.id);
    expect(projAfterUndo?.traces.length).toBe(0);

    const redo = await sdk.redo(design.id, SESSION);
    expect(redo.ok).toBe(true);
    const projAfterRedo = await sdk.getPcbProjection(design.id);
    expect(projAfterRedo?.traces.length).toBe(1);
  });

  test("idempotent re-dispatch returns prior result", async () => {
    isolateTestDb("traces-idempotent");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Traces Idem" });
    const netClassId = await defaultNetClassId(sdk, design.id);

    const env = envelope(design.id, "cmd-idem", SESSION, 0, {
      type: "pcb_add_trace",
      layer: "F.Cu",
      pointsNm: [
        { x: 0, y: 0 },
        { x: 1_000_000, y: 0 },
      ],
      widthMm: 0.25,
      netId: null,
      netClassId,
      segmentMode: "manhattan-90",
    });

    const first = await sdk.dispatchCommand(design.id, env);
    const second = await sdk.dispatchCommand(design.id, env);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.idempotent).toBe(true);
      expect(second.createdEntityId).toBe(first.createdEntityId);
    }

    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.traces.length).toBe(1);
  });

  test("adds a via using net-class diameter/drill", async () => {
    isolateTestDb("traces-via");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Vias" });
    const proj0 = await sdk.getPcbProjection(design.id);
    const netClass = proj0!.board.netClasses[0]!;

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-add-via", SESSION, 0, {
        type: "pcb_add_via",
        centerMm: { x: 1, y: 1 },
        netId: null,
        netClassId: netClass.id,
      }),
    );

    expect(result.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.vias.length).toBe(1);
    expect(proj?.vias[0]?.diameterMm).toBe(netClass.viaDiameterMm);
    expect(proj?.vias[0]?.drillMm).toBe(netClass.viaDrillMm);
    expect(proj?.vias[0]?.fromLayer).toBe("F.Cu");
    expect(proj?.vias[0]?.toLayer).toBe("B.Cu");
  });

  test("combined trace/via command is atomic when via validation fails", async () => {
    isolateTestDb("traces-via-atomic-fail");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Trace Via Atomic" });
    const proj0 = await sdk.getPcbProjection(design.id);
    const netClass = proj0!.board.netClasses[0]!;

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-trace-via-invalid", SESSION, proj0!.revision, {
        type: "pcb_add_trace_via",
        trace: {
          layer: "F.Cu" as PcbCopperLayerId,
          pointsNm: [
            { x: 0, y: 0 },
            { x: 5_000_000, y: 0 },
          ],
          widthMm: 0.25,
          netId: "net-A",
          netClassId: netClass.id,
          segmentMode: "manhattan-90" as PcbTraceSegmentMode,
        },
        via: {
          centerMm: { x: 5, y: 0 },
          netId: "net-A",
          netClassId: netClass.id,
          diameterMmOverride: 0.1,
          drillMmOverride: 0.05,
        },
      }),
    );

    expect(result.ok).toBe(false);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj!.traces).toHaveLength(0);
    expect(proj!.vias).toHaveLength(0);
  });

  test("smart-via flow: F.Cu trace → via → B.Cu trace yields 2 traces + 1 via with one logical net", async () => {
    isolateTestDb("traces-smart-via");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await sdk.createDesign({ name: "Smart Via" });
    const proj0 = await sdk.getPcbProjection(design.id);
    const netClass = proj0!.board.netClasses[0]!;
    const netId = "net-A"; // synthetic net id, no schematic correlation needed

    // 1) F.Cu segment from p0 to viaCenter.
    const p0 = { x: 0, y: 0 };
    const viaCenter = { x: 5_000_000, y: 0 };
    const r1 = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-trace-fcu", SESSION, proj0!.revision, {
        type: "pcb_add_trace",
        layer: "F.Cu" as PcbCopperLayerId,
        pointsNm: [p0, viaCenter],
        widthMm: 0.25,
        netId,
        netClassId: netClass.id,
        segmentMode: "manhattan-90" as PcbTraceSegmentMode,
      }),
    );
    expect(r1.ok).toBe(true);

    // 2) Drop a via at the join point.
    const proj1 = await sdk.getPcbProjection(design.id);
    const r2 = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-via", SESSION, proj1!.revision, {
        type: "pcb_add_via",
        centerMm: { x: 5, y: 0 },
        netId,
        netClassId: netClass.id,
      }),
    );
    expect(r2.ok).toBe(true);

    // 3) B.Cu segment from viaCenter to p2.
    const proj2 = await sdk.getPcbProjection(design.id);
    const p2 = { x: 5_000_000, y: 3_000_000 };
    const r3 = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-trace-bcu", SESSION, proj2!.revision, {
        type: "pcb_add_trace",
        layer: "B.Cu" as PcbCopperLayerId,
        pointsNm: [viaCenter, p2],
        widthMm: 0.25,
        netId,
        netClassId: netClass.id,
        segmentMode: "manhattan-90" as PcbTraceSegmentMode,
      }),
    );
    expect(r3.ok).toBe(true);

    const finalProj = await sdk.getPcbProjection(design.id);
    expect(finalProj!.traces).toHaveLength(2);
    expect(finalProj!.vias).toHaveLength(1);

    // Per-layer traces, never merged.
    const layers = finalProj!.traces.map((t) => t.layer).sort();
    expect(layers).toEqual(["B.Cu", "F.Cu"]);

    // All three records share the same net id.
    for (const t of finalProj!.traces) expect(t.netId).toBe(netId);
    expect(finalProj!.vias[0]!.netId).toBe(netId);
  });
});
