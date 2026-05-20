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
