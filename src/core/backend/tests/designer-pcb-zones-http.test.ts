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
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
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

describe("designer PCB zones — nets", () => {
  test("a named net persists as netName and the projection binds it", async () => {
    const { sdk } = await createRuntime("zone-net-name");
    const design = await sdk.createDesign({ name: "Named net" });
    // A label is the cheapest way to get a named schematic net.
    const label = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "upsert_label",
        text: "GND",
        positionNm: { x: 0, y: 0 },
      }),
    );
    expect(label.ok).toBe(true);
    const netId = Object.entries(
      (await sdk.getPcbProjection(design.id))!.netNames,
    ).find(([, name]) => name === "GND")![0];

    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: "GND" },
        region: { kind: "polygon", pointsMm: SQUARE },
      }),
    );
    expect(add.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.zones[0]?.netName).toBe("GND");
    expect(proj?.zones[0]?.netId).toBe(netId);
    expect(
      collectCopperZones({
        zones: proj!.zones,
        layerCount: proj!.board.layerCount,
        knownNetIds: new Set(Object.keys(proj!.netNames)),
      }).zones.map((z) => z.netId),
    ).toEqual([netId]);
  });

  test("an empty net id is stored as null, and a net-less zone still pours", async () => {
    const { sdk } = await createRuntime("zone-net-less");
    const design = await sdk.createDesign({ name: "Net-less" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: "", netName: "" },
        region: { kind: "polygon", pointsMm: SQUARE },
      }),
    );
    expect(add.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.zones[0]).toMatchObject({ netId: null, netName: null });
    const derived = collectCopperZones({
      zones: proj!.zones,
      layerCount: proj!.board.layerCount,
      knownNetIds: new Set(Object.keys(proj!.netNames)),
    });
    expect(derived.zones).toHaveLength(1);
    expect(derived.zones[0]?.netId).toBeNull();
  });
});

describe("designer PCB zones — projection warnings", () => {
  test("an ambiguous zone net is reported once, not also as unresolved", async () => {
    const { sdk, server } = await createRuntime("zone-net-ambiguous");
    const design = await sdk.createDesign({ name: "Ambiguous" });
    // Same-text labels are ONE net since T-097, so a duplicated name can only
    // come from a label that spells an auto-generated name: the capacitor's
    // two unconnected pins are `Net_1` / `Net_2`, and a lone `Net_1` label is
    // a second, unrelated net of that name.
    const componentId = await importCapacitorComponent(server);
    await placeCapacitors(sdk, design.id, componentId, 1);
    const label = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "upsert_label",
        text: "Net_1",
        positionNm: { x: 90_000_000, y: 90_000_000 },
      }),
    );
    expect(label.ok).toBe(true);
    const nets = Object.values(
      (await sdk.getPcbProjection(design.id))!.netNames,
    ).filter((name) => name === "Net_1");
    expect(nets.length).toBeGreaterThan(1);

    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: "Net_1" },
        region: { kind: "polygon", pointsMm: SQUARE },
      }),
    );
    expect(add.ok).toBe(true);
    const warnings = (await sdk.getPcbProjection(design.id))!.warnings;
    expect(
      warnings.filter((w) => w.startsWith("zone_net_ambiguous")),
    ).toHaveLength(1);
    expect(warnings.some((w) => w.startsWith("zone_net_unresolved"))).toBe(
      false,
    );
  });
});

describe("designer PCB zones — HTTP parser arms", () => {
  test("every add and update field survives the round trip", async () => {
    const { sdk, server } = await createRuntime("zone-http");
    const design = await sdk.createDesign({ name: "HTTP zone" });

    const addResponse = await postCommand(server, design.id, {
      type: "pcb_add_zone",
      layer: "F.Cu",
      net: { netId: "net-frozen", netName: null },
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
      // A persisted netId that no current net holds stays as written; the
      // derivation is what calls it stale.
      netId: "net-frozen",
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
      netId: null,
      netName: "VCC",
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
      netName: "GND",
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
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE },
      }),
    );
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

    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE },
        name: "H1",
      }),
    );
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
        await sdk.dispatchCommand(
          design.id,
          envelope(design.id, {
            type: "pcb_update_zone",
            zoneId,
            name: "H2",
            priority: 5,
          }),
        )
      ).ok,
    ).toBe(true);
    expect((await zones())[0]).toMatchObject({ name: "H2", priority: 5 });
    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect((await zones())[0]).toMatchObject({ name: "H1", priority: 0 });
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect((await zones())[0]).toMatchObject({ name: "H2", priority: 5 });

    expect(
      (
        await sdk.dispatchCommand(
          design.id,
          envelope(design.id, { type: "pcb_delete_zone", zoneId }),
        )
      ).ok,
    ).toBe(true);
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

    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE },
      }),
    );
    if (!add.ok) return;
    const zoneId = add.createdEntityId!;

    expect(
      (
        await sdk.dispatchCommand(
          design.id,
          envelope(design.id, {
            type: "pcb_update_zone",
            zoneId,
            region: { kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] },
          }),
        )
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
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_set_view_state",
        // An old client still sending the removed keys.
        patch: { copperFillLayers: ["F.Cu"] } as never,
      }),
    );
    expect(result.ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.zones).toEqual([]);
  });
});
