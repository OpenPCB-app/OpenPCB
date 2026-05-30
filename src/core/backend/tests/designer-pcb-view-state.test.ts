import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerSDK,
  PcbViewState,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const SESSION = "designer-pcb-view-state";

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
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
  baseRevision: number | null,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  return {
    commandId,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision,
    issuedAt: Date.now(),
    command,
  };
}

async function createDesignerSdk(testLabel: string): Promise<{
  sdk: DesignerSDK;
  designId: string;
}> {
  isolateTestDb(testLabel);
  const { moduleRuntime } = await createRuntime();
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const design = await sdk.createDesign({ name: testLabel });
  return { sdk, designId: design.id };
}

// Variant that keeps the HTTP server so a command can be dispatched through the
// REAL route (parseCommandEnvelope / parsePcbSetDesignRulesCommand) — the
// in-process SDK bypasses that parser, where new command fields get dropped.
async function createDesignerHttp(testLabel: string): Promise<{
  sdk: DesignerSDK;
  server: Awaited<ReturnType<typeof createRuntime>>["server"];
  designId: string;
}> {
  isolateTestDb(testLabel);
  const { moduleRuntime, server } = await createRuntime();
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const design = await sdk.createDesign({ name: testLabel });
  return { sdk, server, designId: design.id };
}

async function postCommand(
  server: Awaited<ReturnType<typeof createRuntime>>["server"],
  designId: string,
  baseRevision: number | null,
  command: DesignerCommandEnvelope["command"],
): Promise<Response> {
  return server.fetch(
    new Request(
      `http://localhost/api/modules/designer/designs/${designId}/commands`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          envelope(designId, crypto.randomUUID(), baseRevision, command),
        ),
      },
    ),
  );
}

describe("designer PCB view-state persistence", () => {
  test("new boards start with default viewState", async () => {
    const { sdk, designId } = await createDesignerSdk("pcb-view-state-default");
    const projection = await sdk.getPcbProjection(designId);
    const viewState = projection?.board.viewState;

    expect(viewState).toBeDefined();
    expect(viewState?.viewSide).toBe("top");
    expect(viewState?.displayMode).toBe("normal");
    expect(viewState?.layerPreset).toBe("custom");
    expect(viewState?.copperFillLayers).toEqual([]);
    expect(viewState?.copperFillPourNetIds).toEqual({});
    expect(viewState?.perLayerOpacity).toEqual({});
    expect(viewState?.ratsnestVisible).toBe(true);
  });

  test("pcb_set_view_state persists a partial patch and round-trips through projection", async () => {
    const { sdk, designId } = await createDesignerSdk(
      "pcb-view-state-roundtrip",
    );
    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-vs-roundtrip", 0, {
        type: "pcb_set_view_state",
        patch: {
          viewSide: "bottom",
          displayMode: "dim",
          copperFillLayers: ["F.Cu", "B.Cu"],
          copperFillPourNetIds: { "F.Cu": "net-a", "B.Cu": null },
          layerPreset: "top-side",
          ratsnestVisible: false,
        },
      }),
    );
    expect(result.ok).toBe(true);

    const projection = await sdk.getPcbProjection(designId);
    const viewState = projection?.board.viewState;
    expect(viewState?.viewSide).toBe("bottom");
    expect(viewState?.displayMode).toBe("dim");
    expect(viewState?.copperFillLayers).toEqual(["F.Cu", "B.Cu"]);
    expect(viewState?.copperFillPourNetIds).toEqual({
      "F.Cu": "net-a",
      "B.Cu": null,
    });
    expect(viewState?.layerPreset).toBe("top-side");
    expect(viewState?.ratsnestVisible).toBe(false);
  });

  test("DRC waivers + ignored rule-classes persist through pcb_set_view_state", async () => {
    const { sdk, designId } = await createDesignerSdk("pcb-view-state-drc");
    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-vs-drc", 0, {
        type: "pcb_set_view_state",
        patch: {
          drcWaivedViolationIds: ["TRACE_TO_TRACE_CLEARANCE-abc123"],
          // includes a bogus rule-class that must be filtered on persist
          drcIgnoredRuleClasses: ["manufacturability", "bogus" as never],
        },
      }),
    );
    expect(result.ok).toBe(true);

    const projection = await sdk.getPcbProjection(designId);
    const viewState = projection?.board.viewState;
    expect(viewState?.drcWaivedViolationIds).toEqual([
      "TRACE_TO_TRACE_CLEARANCE-abc123",
    ]);
    expect(viewState?.drcIgnoredRuleClasses).toEqual(["manufacturability"]);
  });

  test("pcb_set_design_rules persists rules, net classes, thickness through reload", async () => {
    const { sdk, designId } = await createDesignerSdk("pcb-design-rules");
    const baseProj = await sdk.getPcbProjection(designId);
    const base = baseProj!.board.designRules;
    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-rules", 0, {
        type: "pcb_set_design_rules",
        designRules: {
          clearance: { ...base.clearance, traceToTraceMm: 0.5 },
          minimums: { ...base.minimums, holeToHoleMm: 0.4 },
        },
        netClasses: baseProj!.board.netClasses.map((c) => ({
          ...c,
          clearanceMm: 0.6,
        })),
        boardThicknessMm: 2.0,
      }),
    );
    expect(result.ok).toBe(true);

    // Reload from the DB — exercises parseBoardSettings (previously dropped these).
    const proj = await sdk.getPcbProjection(designId);
    expect(proj?.board.designRules.clearance.traceToTraceMm).toBe(0.5);
    expect(proj?.board.designRules.minimums.holeToHoleMm).toBe(0.4);
    expect(proj?.board.boardThicknessMm).toBe(2.0);
    expect(proj?.board.netClasses[0]?.clearanceMm).toBe(0.6);
  });

  test("pcb_set_view_state does not create undo history entries", async () => {
    const { sdk, designId } = await createDesignerSdk("pcb-view-state-no-undo");
    const before = await sdk.getHistory(designId, SESSION);
    expect(before.undoDepth).toBe(0);

    const viewOnly = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-vs-view-only", 0, {
        type: "pcb_set_view_state",
        patch: { viewSide: "bottom", displayMode: "solo" },
      }),
    );
    expect(viewOnly.ok).toBe(true);

    const after = await sdk.getHistory(designId, SESSION);
    expect(after.canUndo).toBe(false);
    expect(after.undoDepth).toBe(0);

    const undo = await sdk.undo(designId, SESSION);
    expect(undo.ok).toBe(false);
    if (!undo.ok) expect(undo.code).toBe("HISTORY_EMPTY");
    const projection = await sdk.getPcbProjection(designId);
    expect(projection?.board.viewState?.viewSide).toBe("bottom");
  });

  test("partial patches merge displayMode and viewSide across commands", async () => {
    const { sdk, designId } = await createDesignerSdk("pcb-view-state-merge");
    const first = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-vs-merge-display", 0, {
        type: "pcb_set_view_state",
        patch: { displayMode: "solo" },
      }),
    );
    expect(first.ok).toBe(true);

    const second = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-vs-merge-side", 1, {
        type: "pcb_set_view_state",
        patch: { viewSide: "bottom" },
      }),
    );
    expect(second.ok).toBe(true);

    const projection = await sdk.getPcbProjection(designId);
    expect(projection?.board.viewState?.displayMode).toBe("solo");
    expect(projection?.board.viewState?.viewSide).toBe("bottom");
  });

  test("perLayerOpacity values outside 0..1 are clamped on read", async () => {
    const { sdk, designId } = await createDesignerSdk("pcb-view-state-opacity");
    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-vs-opacity", 0, {
        type: "pcb_set_view_state",
        patch: { perLayerOpacity: { "F.Cu": -0.25, "B.Cu": 1.4, Drill: 0.55 } },
      }),
    );
    expect(result.ok).toBe(true);

    const projection = await sdk.getPcbProjection(designId);
    expect(projection?.board.viewState?.perLayerOpacity).toEqual({
      "F.Cu": 0,
      "B.Cu": 1,
      Drill: 0.55,
    });
  });

  test("unknown fields in view-state patch are dropped from stored projection", async () => {
    const { sdk, designId } = await createDesignerSdk("pcb-view-state-unknown");
    const patch = {
      viewSide: "bottom",
      unknownField: "must-not-persist",
    } as Partial<PcbViewState> & Record<string, unknown>;

    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-vs-unknown", 0, {
        type: "pcb_set_view_state",
        patch,
      }),
    );
    expect(result.ok).toBe(true);

    const projection = await sdk.getPcbProjection(designId);
    const viewStateRecord = projection?.board.viewState as
      | Record<string, unknown>
      | undefined;
    expect(viewStateRecord?.viewSide).toBe("bottom");
    expect(viewStateRecord?.unknownField).toBeUndefined();
  });

  test("perNetClassAssignments round-trips through the real HTTP command route", async () => {
    const { sdk, server, designId } = await createDesignerHttp(
      "pcb-per-net-class-http",
    );
    const rev0 = (await sdk.getPcbProjection(designId))?.revision ?? null;
    // Routed through the real parser — if parsePcbSetDesignRulesCommand did NOT
    // forward perNetClassAssignments, the field would silently vanish here.
    const res = await postCommand(server, designId, rev0, {
      type: "pcb_set_design_rules",
      perNetClassAssignments: {
        "net-power": "power",
        "net-bogus": "does-not-exist",
      },
    });
    expect(res.status).toBe(200);

    const proj = await sdk.getPcbProjection(designId);
    // Known class persists; the unknown class id is dropped on persist.
    expect(proj?.board.perNetClassAssignments).toEqual({
      "net-power": "power",
    });
  });

  test("a new trace on an assigned net adopts that class's width (HTTP, apply-at-creation)", async () => {
    const { sdk, server, designId } = await createDesignerHttp(
      "pcb-per-net-class-apply",
    );
    const rev0 = (await sdk.getPcbProjection(designId))?.revision ?? null;
    await postCommand(server, designId, rev0, {
      type: "pcb_set_design_rules",
      perNetClassAssignments: { n1: "power" }, // power class width = 0.5 mm
    });

    const rev1 = (await sdk.getPcbProjection(designId))?.revision ?? null;
    // Default class + default width — no deliberate choice, so the backend
    // safety net should upgrade both to the assigned "power" class.
    await postCommand(server, designId, rev1, {
      type: "pcb_add_trace",
      layer: "F.Cu",
      pointsNm: [
        { x: 0, y: 0 },
        { x: 1_000_000, y: 0 },
      ],
      widthMm: 0.25,
      netId: "n1",
      netClassId: "default",
      segmentMode: "manhattan-90",
    });

    const proj = await sdk.getPcbProjection(designId);
    const trace = proj?.traces.find((t) => t.netId === "n1");
    expect(trace?.netClassId).toBe("power");
    expect(trace?.widthMm).toBe(0.5);
  });
});
