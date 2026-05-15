import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerCommandEnvelope, DesignerSDK, PcbViewState } from "../../../sdks";
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
  const moduleRuntime = new ModuleRuntime({ moduleRegistry, workspaceRoot: repoRoot });
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
    const { sdk, designId } = await createDesignerSdk("pcb-view-state-roundtrip");
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
    expect(viewState?.copperFillPourNetIds).toEqual({ "F.Cu": "net-a", "B.Cu": null });
    expect(viewState?.layerPreset).toBe("top-side");
    expect(viewState?.ratsnestVisible).toBe(false);
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
    const viewStateRecord = projection?.board.viewState as Record<string, unknown> | undefined;
    expect(viewStateRecord?.viewSide).toBe("bottom");
    expect(viewStateRecord?.unknownField).toBeUndefined();
  });
});
