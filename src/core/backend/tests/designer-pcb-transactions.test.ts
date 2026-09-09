import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerPcbProjection,
  DesignerSDK,
  PcbCopperLayerId,
  PcbPlacedPart,
  PcbTraceSegmentMode,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { getKicadFixtureDir } from "./helpers/kicad-fixtures";

const SESSION = "designer-pcb-session";

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

async function importFixtureComponent(
  server: ReturnType<typeof createHttpServer>,
): Promise<string> {
  const fixtureDir = getKicadFixtureDir();
  const symbolPath = path.resolve(fixtureDir, "simple_capacitor.kicad_sym");
  const footprintPath = path.resolve(fixtureDir, "C_0603_1608Metric.kicad_mod");
  const symbolContent = await Bun.file(symbolPath).text();
  const footprintContent = await Bun.file(footprintPath).text();

  const inspectResponse = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbolLibrary: { fileName: "C.kicad_sym", content: symbolContent },
        footprints: [
          {
            fileName: "C_0603_1608Metric.kicad_mod",
            content: footprintContent,
          },
        ],
      }),
    }),
  );
  expect(inspectResponse.status).toBe(200);
  const inspectBody = (await inspectResponse.json()) as {
    data?: {
      symbols?: Array<{ id: string }>;
      footprints?: Array<{ id: string }>;
    };
  };
  const symbolId = inspectBody.data?.symbols?.[0]?.id;
  const footprintId = inspectBody.data?.footprints?.[0]?.id;
  if (!symbolId || !footprintId) {
    throw new Error("Fixture inspect must return symbol and footprint ids");
  }

  const commitResponse = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/kicad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbolLibrary: { fileName: "C.kicad_sym", content: symbolContent },
        footprints: [
          {
            fileName: "C_0603_1608Metric.kicad_mod",
            content: footprintContent,
          },
        ],
        selection: { symbolId, footprintId },
        component: {
          name: `PCB Txn Capacitor ${crypto.randomUUID()}`,
          description: "PCB transaction test component",
        },
      }),
    }),
  );
  expect(commitResponse.status).toBe(201);
  const commitBody = (await commitResponse.json()) as {
    data?: { componentId?: string };
  };
  const componentId = commitBody.data?.componentId;
  if (!componentId) throw new Error("Fixture commit must return componentId");
  return componentId;
}

function placementSnapshot(placements: PcbPlacedPart[]) {
  return placements
    .map((placement) => ({
      id: placement.id,
      partId: placement.partId,
      positionMm: placement.positionMm,
      mirrored: placement.mirrored,
      layer: placement.layer,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function setupPcbWithPlacements(label: string): Promise<{
  sdk: DesignerSDK;
  designId: string;
  projection: DesignerPcbProjection;
  revision: number;
}> {
  isolateTestDb(label);
  const { moduleRuntime, server } = await createRuntime();
  const componentId = await importFixtureComponent(server);
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const design = await sdk.createDesign({ name: label });
  let revision = 0;

  for (let index = 0; index < 3; index += 1) {
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, `place-${label}-${index}`, revision, {
        type: "place_part",
        componentId,
        positionNm: { x: index * 4_000_000, y: 0 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("place_part failed");
    revision = result.revision;
  }

  const projection = await sdk.getPcbProjection(design.id);
  if (!projection || projection.placements.length < 3) {
    throw new Error("PCB projection must contain at least three placements");
  }
  return { sdk, designId: design.id, projection, revision };
}

describe("designer PCB batch operations — one-undo invariant", () => {
  test("pcb_move_placements with 3+ placements restores all placements with one undo", async () => {
    const { sdk, designId, projection, revision } =
      await setupPcbWithPlacements("pcb-txn-move-placements");
    const before = placementSnapshot(projection.placements);
    const targets = projection.placements.slice(0, 3);

    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-move-placements", revision, {
        type: "pcb_move_placements",
        updates: targets.map((placement, index) => ({
          placementId: placement.id,
          positionMm: { x: 25 + index * 2, y: 35 + index * 3 },
        })),
      }),
    );
    expect(result.ok).toBe(true);

    const undo = await sdk.undo(designId, SESSION);
    expect(undo.ok).toBe(true);
    const afterUndo = await sdk.getPcbProjection(designId);
    expect(placementSnapshot(afterUndo?.placements ?? [])).toEqual(before);
  });

  test("pcb_flip_placements with 3+ placements restores all layers with one undo", async () => {
    const { sdk, designId, projection, revision } =
      await setupPcbWithPlacements("pcb-txn-flip-placements");
    const before = placementSnapshot(projection.placements);
    const placementIds = projection.placements.slice(0, 3).map((p) => p.id);

    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-flip-placements", revision, {
        type: "pcb_flip_placements",
        placementIds,
      }),
    );
    expect(result.ok).toBe(true);

    const undo = await sdk.undo(designId, SESSION);
    expect(undo.ok).toBe(true);
    const afterUndo = await sdk.getPcbProjection(designId);
    expect(placementSnapshot(afterUndo?.placements ?? [])).toEqual(before);
  });

  test("pcb_add_trace_via adds trace and via as a single undoable command", async () => {
    isolateTestDb("pcb-txn-trace-via");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Txn TraceVia" });
    const projection = await sdk.getPcbProjection(design.id);
    const netClassId = projection!.board.netClasses[0]!.id;

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-trace-via", 0, {
        type: "pcb_add_trace_via",
        trace: {
          layer: "F.Cu" as PcbCopperLayerId,
          pointsNm: [
            { x: 0, y: 0 },
            { x: 3_000_000, y: 0 },
          ],
          widthMm: 0.25,
          netId: null,
          netClassId,
          segmentMode: "manhattan-90" as PcbTraceSegmentMode,
        },
        via: { centerMm: { x: 3, y: 0 }, netId: null, netClassId },
      }),
    );
    expect(result.ok).toBe(true);

    const undo = await sdk.undo(design.id, SESSION);
    expect(undo.ok).toBe(true);
    const undone = await sdk.getPcbProjection(design.id);
    expect(undone?.traces).toEqual([]);
    expect(undone?.vias).toEqual([]);
  });

  test("pcb_commit_route lands N traces + M vias as ONE undoable command", async () => {
    isolateTestDb("pcb-txn-commit-route");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Txn CommitRoute" });
    const projection = await sdk.getPcbProjection(design.id);
    const netClassId = projection!.board.netClasses[0]!.id;
    const run = (
      layer: PcbCopperLayerId,
      pointsNm: Array<{ x: number; y: number }>,
      widthMm = 0.25,
    ) => ({
      layer,
      pointsNm,
      widthMm,
      netId: null,
      netClassId,
      segmentMode: "manhattan-90" as PcbTraceSegmentMode,
    });

    // Multi-layer session with a width split: 3 runs + 2 vias.
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-commit-route", 0, {
        type: "pcb_commit_route",
        traces: [
          run("F.Cu", [
            { x: 0, y: 0 },
            { x: 3_000_000, y: 0 },
          ]),
          run("B.Cu", [
            { x: 3_000_000, y: 0 },
            { x: 6_000_000, y: 0 },
          ]),
          run(
            "F.Cu",
            [
              { x: 6_000_000, y: 0 },
              { x: 9_000_000, y: 0 },
            ],
            0.5,
          ),
        ],
        vias: [
          { centerMm: { x: 3, y: 0 }, netId: null, netClassId },
          { centerMm: { x: 6, y: 0 }, netId: null, netClassId },
        ],
      }),
    );
    expect(result.ok).toBe(true);

    const committed = await sdk.getPcbProjection(design.id);
    expect(committed?.traces).toHaveLength(3);
    expect(committed?.vias).toHaveLength(2);
    expect(committed?.traces.map((t) => t.layer).sort()).toEqual([
      "B.Cu",
      "F.Cu",
      "F.Cu",
    ]);
    expect(committed?.traces.find((t) => t.widthMm === 0.5)).toBeDefined();

    const undo = await sdk.undo(design.id, SESSION);
    expect(undo.ok).toBe(true);
    const undone = await sdk.getPcbProjection(design.id);
    expect(undone?.traces).toEqual([]);
    expect(undone?.vias).toEqual([]);
  });

  test("pcb_commit_route rejects the whole batch on the first invalid item", async () => {
    isolateTestDb("pcb-txn-commit-route-atomic");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Txn CommitRoute Atomic" });
    const projection = await sdk.getPcbProjection(design.id);
    const netClassId = projection!.board.netClasses[0]!.id;

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-commit-route-bad", 0, {
        type: "pcb_commit_route",
        traces: [
          {
            layer: "F.Cu" as PcbCopperLayerId,
            pointsNm: [
              { x: 0, y: 0 },
              { x: 3_000_000, y: 0 },
            ],
            widthMm: 0.25,
            netId: null,
            netClassId,
            segmentMode: "manhattan-90" as PcbTraceSegmentMode,
          },
          {
            layer: "F.Cu" as PcbCopperLayerId,
            // Single distinct point — invalid path; must reject the batch.
            pointsNm: [
              { x: 5_000_000, y: 0 },
              { x: 5_000_000, y: 0 },
            ],
            widthMm: 0.25,
            netId: null,
            netClassId,
            segmentMode: "manhattan-90" as PcbTraceSegmentMode,
          },
        ],
        vias: [{ centerMm: { x: 3, y: 0 }, netId: null, netClassId }],
      }),
    );
    expect(result.ok).toBe(false);

    // Nothing persisted — not even the valid first trace or the via.
    const after = await sdk.getPcbProjection(design.id);
    expect(after?.traces).toEqual([]);
    expect(after?.vias).toEqual([]);
  });

  test("pcb_commit_route rejects an empty batch", async () => {
    isolateTestDb("pcb-txn-commit-route-empty");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Txn CommitRoute Empty" });

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-commit-route-empty", 0, {
        type: "pcb_commit_route",
        traces: [],
        vias: [],
      }),
    );
    expect(result.ok).toBe(false);
  });

  test("pcb_add_via honors layer spans (advancedVias on in dev/test)", async () => {
    isolateTestDb("pcb-txn-via-span");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Txn ViaSpan" });
    const projection = await sdk.getPcbProjection(design.id);
    const netClassId = projection!.board.netClasses[0]!.id;

    // Blind F.Cu→B.Cu accepted (flag on in test builds), type persisted.
    // `legality: "off"` because this is about the CREATION gate, which is
    // deliberately permissive about span topology (audit B2-7) — the commit
    // gate refuses the same via on `VIA_LAYER_SPAN` (contract 07 §6).
    const blind = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-blind-via", 0, {
        type: "pcb_add_via",
        centerMm: { x: 1, y: 1 },
        netId: null,
        netClassId,
        fromLayer: "F.Cu" as PcbCopperLayerId,
        toLayer: "B.Cu" as PcbCopperLayerId,
        viaType: "blind" as const,
        legality: "off",
      }),
    );
    expect(blind.ok).toBe(true);
    const withBlind = await sdk.getPcbProjection(design.id);
    const via = withBlind?.vias.find((v) => v.viaType === "blind");
    expect(via?.fromLayer).toBe("F.Cu");
    expect(via?.toLayer).toBe("B.Cu");

    // Upward span rejected (must go downward through the stackup).
    const upward = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-upward-via", blind.ok ? blind.revision : 0, {
        type: "pcb_add_via",
        centerMm: { x: 2, y: 1 },
        netId: null,
        netClassId,
        fromLayer: "B.Cu" as PcbCopperLayerId,
        toLayer: "F.Cu" as PcbCopperLayerId,
        viaType: "buried" as const,
      }),
    );
    expect(upward.ok).toBe(false);

    // Explicit non-default span on a THROUGH via rejected (always F.Cu→B.Cu).
    const badThrough = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-bad-through", blind.ok ? blind.revision : 0, {
        type: "pcb_add_via",
        centerMm: { x: 3, y: 1 },
        netId: null,
        netClassId,
        toLayer: "In2.Cu" as PcbCopperLayerId,
      }),
    );
    expect(badThrough.ok).toBe(false);
  });

  test("inner-layer via span is rejected on a 2-layer board", async () => {
    isolateTestDb("pcb-txn-via-span-2l");
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Txn ViaSpan 2L" });
    const projection = await sdk.getPcbProjection(design.id);
    const netClassId = projection!.board.netClasses[0]!.id;

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-blind-2l", 0, {
        type: "pcb_add_via",
        centerMm: { x: 1, y: 1 },
        netId: null,
        netClassId,
        fromLayer: "F.Cu" as PcbCopperLayerId,
        toLayer: "In1.Cu" as PcbCopperLayerId,
        viaType: "blind" as const,
      }),
    );
    expect(result.ok).toBe(false);
  });

  test("pcb_delete_placement restores the same placement with one undo", async () => {
    const { sdk, designId, projection, revision } =
      await setupPcbWithPlacements("pcb-txn-delete-placement");
    const before = placementSnapshot(projection.placements);
    const deletedPlacementId = projection.placements[0]!.id;

    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-delete-placement", revision, {
        type: "pcb_delete_placement",
        placementId: deletedPlacementId,
      }),
    );
    expect(result.ok).toBe(true);

    const undo = await sdk.undo(designId, SESSION);
    expect(undo.ok).toBe(true);
    const afterUndo = await sdk.getPcbProjection(designId);
    expect(placementSnapshot(afterUndo?.placements ?? [])).toEqual(before);
  });
});
