import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommand,
  DesignerCommandEnvelope,
  DesignerSDK,
  LibrarySDK,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { generateFootprint } from "../../../shared/rendering/ipc7351b";
import { getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MentionRegistry } from "../mentions";

const PLACEHOLDER = "fp-no-footprint-yet";
const SESSION = "refresh-fp-session";

async function boot() {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `refresh-fp-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  const registry = moduleRuntime.getSdkRegistry();
  return {
    server,
    library: registry.resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY),
    designer: registry.resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER),
  };
}
type Env = Awaited<ReturnType<typeof boot>>;

async function lib(env: Env, method: string, url: string, body: unknown) {
  const res = await env.server.fetch(
    new Request(`http://localhost/api/modules/library${url}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as any };
}

async function importNone(env: Env, name: string, numbers: string[]) {
  const pins = numbers.map((n, i) => ({
    id: `p${n}`,
    name: n,
    number: n,
    electricalType: "passive",
    positionMm: { x: 0, y: i * 5.08 },
    lengthMm: 1,
    rotationDeg: 0,
    unit: 1,
    hidden: false,
  }));
  const res = await lib(env, "POST", "/imports/drawn", {
    drawnSymbol: {
      source: { name, unitCount: 1, referenceText: "U?", valueText: name, pins, graphics: [], warnings: [] },
      referencePrefix: "U",
    },
    footprintMode: "none",
    component: { name, description: "refresh test" },
  });
  expect(res.status).toBe(201);
  return res.json.data.componentId as string;
}

async function send(env: Env, designId: string, command: DesignerCommand) {
  const head = await env.designer.getSchematicProjection(designId);
  const envelope: DesignerCommandEnvelope = {
    commandId: crypto.randomUUID(),
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: head?.revision ?? null,
    issuedAt: Date.now(),
    command,
  };
  return env.designer.dispatchCommand(designId, envelope);
}

async function okSend(env: Env, designId: string, command: DesignerCommand) {
  const result = await send(env, designId, command);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}

/** Two parts of `componentId`, pin `wirePin` of each joined by a wire. */
async function setup(env: Env, componentId: string, wirePin: string) {
  const design = await env.designer.createDesign();
  const a = await okSend(env, design.id, {
    type: "place_part", componentId, positionNm: { x: 0, y: 0 },
  });
  const b = await okSend(env, design.id, {
    type: "place_part", componentId, positionNm: { x: 40_000_000, y: 0 },
  });
  const proj = (await env.designer.getSchematicProjection(design.id))!;
  const pinOf = (partId: string) =>
    proj.parts.find((p) => p.id === partId)!.pins.find((p) => p.number === wirePin)!.id;
  await okSend(env, design.id, {
    type: "create_wire",
    sourcePinId: pinOf(a.createdEntityId!),
    targetPinId: pinOf(b.createdEntityId!),
  });
  return { designId: design.id, partA: a.createdEntityId!, partB: b.createdEntityId! };
}

const stale = async (env: Env, designId: string, partId: string) =>
  (await env.designer.getSchematicProjection(designId))!.parts.find((p) => p.id === partId)!
    .footprintStale;

describe("designer: footprintStale + refresh_part_footprint", () => {
  test("stale flag, refresh keeps PCB position, undo restores", async () => {
    const env = await boot();
    const comp = await importNone(env, "RefreshA", ["1", "2"]);
    const { designId, partA, partB } = await setup(env, comp, "1");

    expect(await stale(env, designId, partA)).toBe(false);
    expect(await stale(env, designId, partB)).toBe(false);

    // Move A's PCB placement somewhere distinctive.
    const pcb0 = (await env.designer.getPcbProjection(designId))!;
    const placementA = pcb0.placements.find((p) => p.partId === partA)!;
    expect(placementA.footprint.footprintId).toBe(PLACEHOLDER);
    await okSend(env, designId, {
      type: "pcb_move_placement",
      placementId: placementA.id,
      positionMm: { x: 7.5, y: -3.25 },
    });

    // Library assigns a real footprint → both parts stale.
    const added = await lib(env, "POST", `/components/${comp}/footprints`, {
      mode: "generated",
      source: (({ source, metadata }) => ({ source, metadata }))(
        generateFootprint("soic", "SOIC-8", "nominal"),
      ),
      generator: {
        kind: "ipc7351b",
        family: "soic",
        size: "SOIC-8",
        density: "nominal",
      },
    });
    expect(added.status).toBe(201);
    const newFp = added.json.data.footprintId as string;
    expect(await stale(env, designId, partA)).toBe(true);
    expect(await stale(env, designId, partB)).toBe(true);

    const refreshed = await okSend(env, designId, {
      type: "refresh_part_footprint",
      partIds: [partA],
    });
    expect(refreshed.ok).toBe(true);

    expect(await stale(env, designId, partA)).toBe(false);
    expect(await stale(env, designId, partB)).toBe(true);
    const pcb1 = (await env.designer.getPcbProjection(designId))!;
    const afterA = pcb1.placements.find((p) => p.partId === partA)!;
    expect(afterA.footprint.footprintId).toBe(newFp);
    expect(afterA.footprint.preview?.pads.length).toBe(8);
    expect(afterA.positionMm).toEqual({ x: 7.5, y: -3.25 });
    const stillB = pcb1.placements.find((p) => p.partId === partB)!;
    expect(stillB.footprint.footprintId).toBe(PLACEHOLDER);

    const undone = await env.designer.undo(designId, SESSION);
    expect(undone.ok).toBe(true);
    expect(await stale(env, designId, partA)).toBe(true);
    const pcb2 = (await env.designer.getPcbProjection(designId))!;
    const undoneA = pcb2.placements.find((p) => p.partId === partA)!;
    expect(undoneA.footprint.footprintId).toBe(PLACEHOLDER);
    expect(undoneA.positionMm).toEqual({ x: 7.5, y: -3.25 });
  });

  test("refused with FOOTPRINT_PIN_MISMATCH when a connected pin lacks a pad", async () => {
    const env = await boot();
    const comp = await importNone(env, "RefreshB", ["1", "2"]);
    const { designId, partA } = await setup(env, comp, "2");

    // A footprint whose only pad is "1" (built via a 1-pin component so the
    // library accepts it), then force it onto `comp` behind the library's back.
    const donor = await importNone(env, "Donor", ["1"]);
    const full = generateFootprint("soic", "SOIC-8", "nominal");
    const onePad = {
      source: { ...full.source, pads: full.source.pads.slice(0, 1) },
      metadata: full.metadata,
    };
    const added = await lib(env, "POST", `/components/${donor}/footprints`, {
      mode: "drawn",
      source: onePad,
    });
    expect(added.status).toBe(201);
    getSharedSqlite()
      .query("UPDATE library_components SET footprint_id = ? WHERE id = ?")
      .run(added.json.data.footprintId, comp);
    expect(await stale(env, designId, partA)).toBe(true);

    const result = await send(env, designId, {
      type: "refresh_part_footprint",
      partIds: [partA],
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.code === "FOOTPRINT_PIN_MISMATCH") {
      expect(result.partId).toBe(partA);
      expect(result.missingPinNumbers).toEqual(["2"]);
    } else {
      throw new Error(`unexpected ${JSON.stringify(result)}`);
    }
    // Nothing changed.
    expect(await stale(env, designId, partA)).toBe(true);
    const pcb = (await env.designer.getPcbProjection(designId))!;
    expect(pcb.placements.find((p) => p.partId === partA)!.footprint.footprintId).toBe(
      PLACEHOLDER,
    );
  });

  test("an unconnected pin may lack a pad", async () => {
    const env = await boot();
    const comp = await importNone(env, "RefreshC", ["1", "2"]);
    const { designId, partA } = await setup(env, comp, "1"); // pin 2 unwired
    const donor = await importNone(env, "DonorC", ["1"]);
    const full = generateFootprint("soic", "SOIC-8", "nominal");
    const added = await lib(env, "POST", `/components/${donor}/footprints`, {
      mode: "drawn",
      source: {
        source: { ...full.source, pads: full.source.pads.slice(0, 1) },
        metadata: full.metadata,
      },
    });
    getSharedSqlite()
      .query("UPDATE library_components SET footprint_id = ? WHERE id = ?")
      .run(added.json.data.footprintId, comp);
    const result = await send(env, designId, {
      type: "refresh_part_footprint",
      partIds: [partA],
    });
    expect(result.ok).toBe(true);
    expect(await stale(env, designId, partA)).toBe(false);
  });
});
