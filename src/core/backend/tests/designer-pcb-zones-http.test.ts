/**
 * Copper zones, part two (zone/keepout contract §12.2): the net persistence
 * rule, the HTTP parser arms every command field depends on, and undo/redo.
 * The harness is duplicated on purpose — these tests own their own database.
 */
import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerSDK,
  PcbPointMm,
  PcbZone,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { collectCopperZones } from "../../../shared/pcb-areas/copper-zones";
import { getSharedDb, getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { insertPcbZone } from "../../../modules/designer/backend/pcb/pcb-store";
import { readNetIdentityState, writeNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import {
  importCapacitorComponent,
  placeCapacitors,
} from "./helpers/designer-runtime";

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createRuntime(label: string) {
  isolateTestDb(label);
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
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  return { sdk, server };
}

const SESSION = "zones-http-session";
let commandSeq = 0;

function envelope(
  designId: string,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  commandSeq += 1;
  return {
    commandId: `zone-cmd-${commandSeq}-${crypto.randomUUID()}`,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command,
  };
}

const SQUARE: PcbPointMm[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
const TRIANGLE: PcbPointMm[] = [
  { x: 1, y: 1 },
  { x: 6, y: 1 },
  { x: 1, y: 6 },
];
/** Strictly inside SQUARE — a zone cutout (copper-pour contract §11). */
const HOLE: PcbPointMm[] = [
  { x: 3, y: 3 },
  { x: 7, y: 3 },
  { x: 7, y: 7 },
  { x: 3, y: 7 },
];

async function postCommand(
  server: { fetch: (req: Request) => Response | Promise<Response> },
  designId: string,
  command: unknown,
): Promise<Response> {
  return server.fetch(
    new Request(
      `http://localhost/api/modules/designer/designs/${designId}/commands`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: `http-zone-${crypto.randomUUID()}`,
          sessionId: SESSION,
          aggregateId: designId,
          baseRevision: null,
          issuedAt: Date.now(),
          command,
        }),
      },
    ),
  );
}

function dispatch(sdk: DesignerSDK, designId: string, command: DesignerCommandEnvelope["command"]) {
  return sdk.dispatchCommand(designId, envelope(designId, command));
}

async function namedNet(sdk: DesignerSDK, designId: string, text: string, positionNm = { x: 0, y: 0 }) {
  const result = await dispatch(sdk, designId, { type: "upsert_label", text, positionNm });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  const net = (await sdk.getSchematicProjection(designId))!.nets.find((net) => net.labelIds.includes(result.createdEntityId!))!;
  return { labelId: result.createdEntityId!, netId: net.id };
}

function persistedZones(designId: string): PcbZone[] {
  return getSharedSqlite().query<{ payload_json: string }>(
    "SELECT payload_json FROM designer_pcb_entities WHERE design_id = ? AND kind = 'zone' ORDER BY id",
  ).all(designId).map((row) => JSON.parse(row.payload_json) as PcbZone);
}

describe("designer PCB zones — nets", () => {
  test("a named net binds at command time and keeps its persisted ID after rename", async () => {
    const { sdk } = await createRuntime("zone-net-name");
    const design = await sdk.createDesign({ name: "Named net" });
    const { netId, labelId } = await namedNet(sdk, design.id, "GND");
    const add = await dispatch(sdk, design.id, {
      type: "pcb_add_zone", layer: "F.Cu", net: { netId: null, netName: "GND" },
      region: { kind: "polygon", pointsMm: SQUARE },
    });
    expect(add.ok).toBe(true);
    expect(persistedZones(design.id)[0]).toMatchObject({ netId, netName: null });
    expect((await dispatch(sdk, design.id, {
      type: "upsert_label", labelId, text: "RETURN", positionNm: { x: 0, y: 0 },
    })).ok).toBe(true);
    const projection = (await sdk.getPcbProjection(design.id))!;
    expect(projection.netNames[netId]).toBe("RETURN");
    expect(projection.zones[0]).toMatchObject({ netId, netName: null });
    expect(persistedZones(design.id)[0]).toMatchObject({ netId, netName: null });
    expect(collectCopperZones({ zones: projection.zones, layerCount: projection.board.layerCount,
      knownNetIds: new Set(Object.keys(projection.netNames)) }).zones.map((zone) => zone.netId)).toEqual([netId]);
  });

  test("an empty ID refuses; an explicitly net-less zone still pours", async () => {
    const { sdk } = await createRuntime("zone-net-less");
    const design = await sdk.createDesign({ name: "Net-less" });
    const zone = { type: "pcb_add_zone", layer: "F.Cu", region: { kind: "polygon", pointsMm: SQUARE } } as const;
    expect(await dispatch(sdk, design.id, { ...zone, net: { netId: "", netName: "" } }))
      .toMatchObject({ ok: false, code: "NET_REFERENCE_DANGLING", field: "net.netId", reason: "foreign" });
    expect(persistedZones(design.id)).toEqual([]);
    expect((await dispatch(sdk, design.id, { ...zone, net: { netId: null, netName: "" } })).ok).toBe(true);
    const projection = (await sdk.getPcbProjection(design.id))!;
    expect(projection.zones[0]).toMatchObject({ netId: null, netName: null });
    const derived = collectCopperZones({ zones: projection.zones, layerCount: projection.board.layerCount,
      knownNetIds: new Set(Object.keys(projection.netNames)) });
    expect(derived.zones).toHaveLength(1);
    expect(derived.zones[0]?.netId).toBeNull();
  });
});

describe("designer PCB zones — projection warnings", () => {
  test("an explicit Net_1 label wins the exact name while a connected automatic net keeps its ID and suffix", async () => {
    const { sdk, server } = await createRuntime("zone-net-name-collision");
    const design = await sdk.createDesign({ name: "Name collision" });
    const componentId = await importCapacitorComponent(server);
    await placeCapacitors(sdk, design.id, componentId, 2);
    const parts = (await sdk.getSchematicProjection(design.id))!.parts;
    expect((await dispatch(sdk, design.id, { type: "create_wire",
      sourcePinId: parts[0]!.pins[0]!.id, targetPinId: parts[1]!.pins[0]!.id })).ok).toBe(true);
    const automatic = (await sdk.getSchematicProjection(design.id))!.nets.find((net) => net.wireIds.length > 0)!;
    expect(automatic).toMatchObject({ name: "Net_1", autoNamed: true });
    const explicit = await namedNet(sdk, design.id, "Net_1", { x: 90_000_000, y: 90_000_000 });
    const renamed = (await sdk.getSchematicProjection(design.id))!.nets.find((net) => net.id === automatic.id)!;
    expect(renamed).toMatchObject({ id: automatic.id, name: "Net_1_1", autoNamed: true });
    expect((await dispatch(sdk, design.id, { type: "pcb_add_zone", layer: "F.Cu",
      net: { netId: null, netName: "Net_1" }, region: { kind: "polygon", pointsMm: SQUARE } })).ok).toBe(true);
    expect(persistedZones(design.id)[0]).toMatchObject({ netId: explicit.netId, netName: null });
    expect(explicit.netId).not.toBe(automatic.id);
    const projection = (await sdk.getPcbProjection(design.id))!;
    expect(projection.netNames[automatic.id]).toBe("Net_1_1");
    expect(projection.warnings.some((warning) => warning.startsWith("zone_net_ambiguous") || warning.startsWith("zone_net_unresolved"))).toBe(false);
  });

  test("legacy ambiguity reports once without an extra unresolved warning", async () => {
    const { sdk, server } = await createRuntime("zone-net-legacy-ambiguous");
    const design = await sdk.createDesign({ name: "Legacy ambiguity" });
    writeNetIdentityState(getSharedDb(), { ...readNetIdentityState(getSharedDb(), design.id)!,
      status: "legacy_restored", active: [] });
    const componentId = await importCapacitorComponent(server);
    await placeCapacitors(sdk, design.id, componentId, 1);
    await namedNet(sdk, design.id, "Net_1", { x: 90_000_000, y: 90_000_000 });
    const names = Object.values((await sdk.getPcbProjection(design.id))!.netNames);
    expect(names.filter((name) => name === "Net_1").length).toBeGreaterThan(1);
    expect((await dispatch(sdk, design.id, { type: "pcb_add_zone", layer: "F.Cu",
      net: { netId: null, netName: "Net_1" }, region: { kind: "polygon", pointsMm: SQUARE } })).ok).toBe(true);
    const warnings = (await sdk.getPcbProjection(design.id))!.warnings;
    expect(warnings.filter((warning) => warning.startsWith("zone_net_ambiguous"))).toHaveLength(1);
    expect(warnings.some((warning) => warning.startsWith("zone_net_unresolved"))).toBe(false);
  });

  test("unknown-name updates refuse, while damaged stored hints remain visible and unresolved", async () => {
    const { sdk, server } = await createRuntime("zone-net-unresolved");
    const design = await sdk.createDesign({ name: "Unresolved" });
    const add = await dispatch(sdk, design.id, { type: "pcb_add_zone", layer: "F.Cu",
      net: { netId: null, netName: null }, region: { kind: "polygon", pointsMm: SQUARE } });
    if (!add.ok) throw new Error(JSON.stringify(add));
    const before = persistedZones(design.id);
    const revision = (await sdk.getPcbProjection(design.id))!.revision;
    const response = await postCommand(server, design.id, { type: "pcb_update_zone", zoneId: add.createdEntityId,
      net: { netId: null, netName: "MISSING" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { result: {
      ok: false, code: "NET_REFERENCE_DANGLING", reason: "unknown-name", field: "net.netName", netName: "MISSING",
    } } });
    expect(persistedZones(design.id)).toEqual(before);
    expect((await sdk.getPcbProjection(design.id))!.revision).toBe(revision);
    insertPcbZone(getSharedDb(), design.id, { ...before[0]!, id: "damaged", netId: null, netName: "MISSING" }, new Date().toISOString());
    insertPcbZone(getSharedDb(), design.id, { ...before[0]!, id: "stale", netId: "net-frozen", netName: null }, new Date().toISOString());
    const projection = (await sdk.getPcbProjection(design.id))!;
    expect(projection.zones.find((zone) => zone.id === "damaged")).toMatchObject({ netId: null, netName: "MISSING" });
    expect(projection.warnings.filter((warning) => warning.startsWith("zone_net_unresolved"))).toHaveLength(1);
    expect(projection.warnings.filter((warning) => warning.startsWith("zone_net_stale"))).toHaveLength(1);
    expect(projection.zones.find((zone) => zone.id === "stale")).toMatchObject({ netId: "net-frozen", netName: null });
    expect(persistedZones(design.id).find((zone) => zone.id === "damaged")).toMatchObject({ netId: null, netName: "MISSING" });
  });
});

describe("designer PCB zones — HTTP parser arms", () => {
  test("every add and update field survives the round trip", async () => {
    const { sdk, server } = await createRuntime("zone-http");
    const design = await sdk.createDesign({ name: "HTTP zone" });
    const ground = await namedNet(sdk, design.id, "GND");
    const supply = await namedNet(sdk, design.id, "VCC", { x: 20_000_000, y: 0 });

    const addResponse = await postCommand(server, design.id, {
      type: "pcb_add_zone",
      layer: "F.Cu",
      net: { netId: ground.netId, netName: null },
      region: { kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] },
      name: "Full",
      enabled: false,
      priority: 4,
      padConnection: "thruHoleThermal",
      clearanceMm: 0.35,
      minWidthMm: 0.2,
      thermal: { gapMm: 0.45, spokeWidthMm: 0.3 },
      islandRemoval: { minAreaMm2: 2 },
    });
    expect(addResponse.status).toBe(200);
    const added = (await sdk.getPcbProjection(design.id))!.zones[0]!;
    expect(added).toMatchObject({
      layer: "F.Cu",
      netId: ground.netId,
      netName: null,
      region: { kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] },
      name: "Full",
      enabled: false,
      priority: 4,
      padConnection: "thruHoleThermal",
      clearanceMm: 0.35,
      minWidthMm: 0.2,
      thermal: { gapMm: 0.45, spokeWidthMm: 0.3 },
      islandRemoval: { minAreaMm2: 2 },
      lockedAt: null,
    });

    const updateResponse = await postCommand(server, design.id, {
      type: "pcb_update_zone",
      zoneId: added.id,
      name: "Patched",
      enabled: true,
      layer: "B.Cu",
      net: { netId: null, netName: "VCC" },
      region: { kind: "polygon", pointsMm: TRIANGLE },
      priority: 9,
      padConnection: "solid",
      clearanceMm: 0.5,
      minWidthMm: 0.15,
      thermal: { gapMm: 0.6, spokeWidthMm: 0.5 },
      islandRemoval: "never",
      locked: true,
    });
    expect(updateResponse.status).toBe(200);
    const patched = (await sdk.getPcbProjection(design.id))!.zones[0]!;
    expect(patched).toMatchObject({
      id: added.id,
      name: "Patched",
      enabled: true,
      layer: "B.Cu",
      netId: supply.netId,
      netName: null,
      region: { kind: "polygon", pointsMm: TRIANGLE },
      priority: 9,
      padConnection: "solid",
      clearanceMm: 0.5,
      minWidthMm: 0.15,
      thermal: { gapMm: 0.6, spokeWidthMm: 0.5 },
      islandRemoval: "never",
    });
    expect(typeof patched.lockedAt).toBe("string");
  });

  test("a board region round-trips over HTTP", async () => {
    const { sdk, server } = await createRuntime("zone-http-board");
    const design = await sdk.createDesign({ name: "HTTP board zone" });
    const ground = await namedNet(sdk, design.id, "GND");
    const response = await postCommand(server, design.id, {
      type: "pcb_add_zone",
      layer: "B.Cu",
      net: { netId: null, netName: "GND" },
      region: { kind: "board" },
      priority: 7,
      padConnection: "thermal",
    });
    expect(response.status).toBe(200);
    const zone = (await sdk.getPcbProjection(design.id))!.zones[0]!;
    expect(zone).toMatchObject({
      id: "board:B.Cu",
      layer: "B.Cu",
      netId: ground.netId,
      netName: null,
      region: { kind: "board" },
      priority: 7,
      padConnection: "thermal",
    });
    const cleared = await postCommand(server, design.id, {
      type: "pcb_update_zone",
      zoneId: "board:B.Cu",
      islandRemoval: null,
      enabled: false,
    });
    expect(cleared.status).toBe(200);
    const updated = (await sdk.getPcbProjection(design.id))!.zones[0]!;
    expect(updated.enabled).toBe(false);
    expect("islandRemoval" in updated).toBe(false);
  });

  test("a delete round-trips over HTTP", async () => {
    const { sdk, server } = await createRuntime("zone-http-delete");
    const design = await sdk.createDesign({ name: "HTTP delete" });
    const add = await dispatch(sdk, design.id, {
      type: "pcb_add_zone",
      layer: "F.Cu",
      net: { netId: null, netName: null },
      region: { kind: "polygon", pointsMm: SQUARE },
    });
    if (!add.ok) return;
    const response = await postCommand(server, design.id, {
      type: "pcb_delete_zone",
      zoneId: add.createdEntityId,
    });
    expect(response.status).toBe(200);
    expect((await sdk.getPcbProjection(design.id))?.zones).toEqual([]);
  });
});

describe("designer PCB zones — history", () => {
  test("add, update and delete each undo and redo", async () => {
    const { sdk } = await createRuntime("zone-history");
    const design = await sdk.createDesign({ name: "History" });
    const zones = async () => (await sdk.getPcbProjection(design.id))!.zones;

    const add = await dispatch(sdk, design.id, {
      type: "pcb_add_zone",
      layer: "F.Cu",
      net: { netId: null, netName: null },
      region: { kind: "polygon", pointsMm: SQUARE },
      name: "H1",
    });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const zoneId = add.createdEntityId!;
    expect(await zones()).toHaveLength(1);

    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect(await zones()).toEqual([]);
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect((await zones())[0]?.id).toBe(zoneId);

    expect(
      (
        await dispatch(sdk, design.id, {
          type: "pcb_update_zone",
          zoneId,
          name: "H2",
          priority: 5,
        })
      ).ok,
    ).toBe(true);
    expect((await zones())[0]).toMatchObject({ name: "H2", priority: 5 });
    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect((await zones())[0]).toMatchObject({ name: "H1", priority: 0 });
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect((await zones())[0]).toMatchObject({ name: "H2", priority: 5 });

    expect((await dispatch(sdk, design.id, { type: "pcb_delete_zone", zoneId })).ok).toBe(true);
    expect(await zones()).toEqual([]);
    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect((await zones())[0]).toMatchObject({ id: zoneId, name: "H2" });
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect(await zones()).toEqual([]);
  });

  test("a cutout added by pcb_update_zone undoes and redoes with the region", async () => {
    const { sdk } = await createRuntime("zone-history-hole");
    const design = await sdk.createDesign({ name: "History cutout" });
    const region = async () =>
      (await sdk.getPcbProjection(design.id))!.zones[0]!.region;

    const add = await dispatch(sdk, design.id, {
      type: "pcb_add_zone",
      layer: "F.Cu",
      net: { netId: null, netName: null },
      region: { kind: "polygon", pointsMm: SQUARE },
    });
    if (!add.ok) return;
    const zoneId = add.createdEntityId!;

    expect(
      (
        await dispatch(sdk, design.id, {
          type: "pcb_update_zone",
          zoneId,
          region: { kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] },
        })
      ).ok,
    ).toBe(true);
    expect(await region()).toEqual({
      kind: "polygon",
      pointsMm: SQUARE,
      holesMm: [HOLE],
    });

    // Holes ride inside `region`, so the existing zone history arm covers them
    // with no new patch kind.
    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect(await region()).toEqual({ kind: "polygon", pointsMm: SQUARE });
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect(await region()).toEqual({
      kind: "polygon",
      pointsMm: SQUARE,
      holesMm: [HOLE],
    });
  });

  test("a view-state patch carrying the legacy fill keys creates no board zone", async () => {
    const { sdk } = await createRuntime("zone-view-state");
    const design = await sdk.createDesign({ name: "Legacy patch" });
    const result = await dispatch(sdk, design.id, {
      type: "pcb_set_view_state",
      // An old client still sending the removed keys.
      patch: { copperFillLayers: ["F.Cu"] } as never,
    });
    expect(result.ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.zones).toEqual([]);
  });
});
