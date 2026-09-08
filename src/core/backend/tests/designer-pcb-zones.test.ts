/**
 * The three copper-zone authoring commands (zone/keepout contract §12.2):
 * validation order, the derived board-zone id and the lock lifecycle. The net
 * persistence rule, the HTTP parser arms and undo/redo live in
 * `designer-pcb-zones-http.test.ts`.
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

const SESSION = "zones-session";
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

describe("designer PCB zones — add", () => {
  test("a polygon zone lands in the projection", async () => {
    const { sdk } = await createRuntime("zone-add-polygon");
    const design = await sdk.createDesign({ name: "Polygon zone" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE },
        name: "Pour A",
        priority: 3,
        padConnection: "thermal",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.zones).toHaveLength(1);
    expect(proj?.zones[0]).toMatchObject({
      id: result.createdEntityId!,
      name: "Pour A",
      enabled: true,
      lockedAt: null,
      layer: "F.Cu",
      netId: null,
      netName: null,
      region: { kind: "polygon", pointsMm: SQUARE },
      priority: 3,
      padConnection: "thermal",
    });
  });

  test.each([
    [
      "tooFewPoints",
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
    ],
    [
      "selfIntersecting",
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
    ],
    [
      "zeroArea",
      [
        { x: 0, y: 0 },
        { x: 0.001, y: 0 },
        { x: 0, y: 0.001 },
      ],
    ],
  ] as Array<[string, PcbPointMm[]]>)(
    "an invalid ring is refused (%s)",
    async (reason, pointsMm) => {
      const { sdk } = await createRuntime(`zone-ring-${reason}`);
      const design = await sdk.createDesign({ name: "Bad ring" });
      const result = await sdk.dispatchCommand(
        design.id,
        envelope(design.id, {
          type: "pcb_add_zone",
          layer: "F.Cu",
          net: { netId: null, netName: null },
          region: { kind: "polygon", pointsMm },
        }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      if (result.code !== "INVALID_PCB_ZONE") throw new Error(result.code);
      expect(result.detail).toContain(reason);
    },
  );

  test("a layer off the stackup is refused", async () => {
    const { sdk } = await createRuntime("zone-off-stackup");
    const design = await sdk.createDesign({ name: "Off stackup" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        // The default board is 2-layer, so In1.Cu has no plane.
        layer: "In1.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.code !== "INVALID_PCB_ZONE") throw new Error(result.code);
    expect(result.detail).toContain("stackup");
  });

  test("a fractional priority is refused", async () => {
    const { sdk } = await createRuntime("zone-priority");
    const design = await sdk.createDesign({ name: "Priority" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE },
        priority: 1.5,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.code !== "INVALID_PCB_ZONE") throw new Error(result.code);
    expect(result.detail).toContain("priority");
  });

  test("a board region takes the derived id and refuses a second row", async () => {
    const { sdk } = await createRuntime("zone-board-region");
    const design = await sdk.createDesign({ name: "Board zone" });
    const first = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: "GND" },
        region: { kind: "board" },
      }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.createdEntityId).toBe("board:F.Cu");

    const second = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: "GND" },
        region: { kind: "board" },
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    if (second.code !== "PCB_ZONE_BOARD_EXISTS") throw new Error(second.code);
    expect(second.layer).toBe("F.Cu");
  });

  test("two designs each get their own board:F.Cu (global-PK regression)", async () => {
    const { sdk } = await createRuntime("zone-board-two-designs");
    const a = await sdk.createDesign({ name: "A" });
    const b = await sdk.createDesign({ name: "B" });
    for (const design of [a, b]) {
      const result = await sdk.dispatchCommand(
        design.id,
        envelope(design.id, {
          type: "pcb_add_zone",
          layer: "F.Cu",
          net: { netId: null, netName: null },
          region: { kind: "board" },
        }),
      );
      expect(result.ok).toBe(true);
    }
    expect((await sdk.getPcbProjection(a.id))?.zones.map((z) => z.id)).toEqual([
      "board:F.Cu",
    ]);
    expect((await sdk.getPcbProjection(b.id))?.zones.map((z) => z.id)).toEqual([
      "board:F.Cu",
    ]);
  });
});

describe("designer PCB zones — update and delete", () => {
  async function withPolygonZone(label: string) {
    const { sdk, server } = await createRuntime(label);
    const design = await sdk.createDesign({ name: label });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE },
        clearanceMm: 0.4,
        minWidthMm: 0.25,
        thermal: { gapMm: 0.5, spokeWidthMm: 0.4 },
      }),
    );
    if (!add.ok) throw new Error("zone setup failed");
    return { sdk, server, designId: design.id, zoneId: add.createdEntityId! };
  }

  test("a polygon zone patches every field, and null clears an override", async () => {
    const { sdk, designId, zoneId } = await withPolygonZone("zone-update");
    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, {
        type: "pcb_update_zone",
        zoneId,
        name: "Renamed",
        enabled: false,
        layer: "B.Cu",
        region: { kind: "polygon", pointsMm: TRIANGLE },
        priority: 7,
        padConnection: "none",
        clearanceMm: null,
        minWidthMm: 0.3,
        thermal: null,
        islandRemoval: { minAreaMm2: 1.5 },
      }),
    );
    expect(result.ok).toBe(true);
    const proj = await sdk.getPcbProjection(designId);
    const zone = proj?.zones[0] as PcbZone;
    expect(zone).toMatchObject({
      id: zoneId,
      name: "Renamed",
      enabled: false,
      layer: "B.Cu",
      region: { kind: "polygon", pointsMm: TRIANGLE },
      priority: 7,
      padConnection: "none",
      minWidthMm: 0.3,
      islandRemoval: { minAreaMm2: 1.5 },
    });
    expect("clearanceMm" in zone).toBe(false);
    expect("thermal" in zone).toBe(false);
  });

  test("a board zone rejects layer and region but takes net, enabled and padConnection", async () => {
    const { sdk } = await createRuntime("zone-update-board");
    const design = await sdk.createDesign({ name: "Board update" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "board" },
      }),
    );
    expect(add.ok).toBe(true);

    for (const patch of [
      { layer: "B.Cu" as const },
      { region: { kind: "polygon" as const, pointsMm: SQUARE } },
    ]) {
      const rejected = await sdk.dispatchCommand(
        design.id,
        envelope(design.id, {
          type: "pcb_update_zone",
          zoneId: "board:F.Cu",
          ...patch,
        }),
      );
      expect(rejected.ok).toBe(false);
      if (rejected.ok) continue;
      if (rejected.code !== "INVALID_PCB_ZONE") throw new Error(rejected.code);
      expect(rejected.detail).toContain(
        "board zone layer and region are fixed",
      );
    }

    const accepted = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_update_zone",
        zoneId: "board:F.Cu",
        net: { netId: null, netName: "GND" },
        enabled: false,
        padConnection: "thruHoleThermal",
      }),
    );
    expect(accepted.ok).toBe(true);
    expect((await sdk.getPcbProjection(design.id))?.zones[0]).toMatchObject({
      id: "board:F.Cu",
      netName: "GND",
      enabled: false,
      padConnection: "thruHoleThermal",
      region: { kind: "board" },
      layer: "F.Cu",
    });
  });

  test("a locked zone refuses edits and deletes until unlocked", async () => {
    const { sdk, designId, zoneId } = await withPolygonZone("zone-lock");
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, {
            type: "pcb_update_zone",
            zoneId,
            locked: true,
          }),
        )
      ).ok,
    ).toBe(true);

    const edit = await sdk.dispatchCommand(
      designId,
      envelope(designId, { type: "pcb_update_zone", zoneId, priority: 2 }),
    );
    expect(edit.ok).toBe(false);
    if (!edit.ok && edit.code === "INVALID_PCB_ZONE") {
      expect(edit.detail).toContain("locked");
    }

    const del = await sdk.dispatchCommand(
      designId,
      envelope(designId, { type: "pcb_delete_zone", zoneId }),
    );
    expect(del.ok).toBe(false);
    if (!del.ok && del.code === "INVALID_PCB_ZONE") {
      expect(del.detail).toContain("locked");
    }

    const unlock = await sdk.dispatchCommand(
      designId,
      envelope(designId, { type: "pcb_update_zone", zoneId, locked: false }),
    );
    expect(unlock.ok).toBe(true);
    expect(
      (await sdk.getPcbProjection(designId))?.zones[0]?.lockedAt,
    ).toBeNull();

    const deleted = await sdk.dispatchCommand(
      designId,
      envelope(designId, { type: "pcb_delete_zone", zoneId }),
    );
    expect(deleted.ok).toBe(true);
    expect((await sdk.getPcbProjection(designId))?.zones).toEqual([]);
  });

  test("a locked zone refuses an unlock bundled with edits", async () => {
    const { sdk, designId, zoneId } = await withPolygonZone("zone-lock-bundle");
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, { type: "pcb_update_zone", zoneId, locked: true }),
        )
      ).ok,
    ).toBe(true);
    const bundled = await sdk.dispatchCommand(
      designId,
      envelope(designId, {
        type: "pcb_update_zone",
        zoneId,
        locked: false,
        priority: 3,
        name: "smuggled",
      }),
    );
    expect(bundled.ok).toBe(false);
    if (!bundled.ok && bundled.code === "INVALID_PCB_ZONE") {
      expect(bundled.detail).toContain("unlock first");
    }
    const zone = (await sdk.getPcbProjection(designId))!.zones[0]!;
    expect(zone.lockedAt).not.toBeNull();
    expect(zone.priority).toBe(0);
    expect(zone.name).not.toBe("smuggled");
  });

  test("islandRemoval: null clears the override", async () => {
    const { sdk, designId, zoneId } = await withPolygonZone("zone-island-null");
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, {
            type: "pcb_update_zone",
            zoneId,
            islandRemoval: "never",
          }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (await sdk.getPcbProjection(designId))!.zones[0]!.islandRemoval,
    ).toBe("never");
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, {
            type: "pcb_update_zone",
            zoneId,
            islandRemoval: null,
          }),
        )
      ).ok,
    ).toBe(true);
    expect(
      "islandRemoval" in (await sdk.getPcbProjection(designId))!.zones[0]!,
    ).toBe(false);
  });

  test("an unknown zone id is PCB_ZONE_NOT_FOUND on update and delete", async () => {
    const { sdk } = await createRuntime("zone-not-found");
    const design = await sdk.createDesign({ name: "Missing" });
    for (const command of [
      { type: "pcb_update_zone" as const, zoneId: "nope", priority: 1 },
      { type: "pcb_delete_zone" as const, zoneId: "nope" },
    ]) {
      const result = await sdk.dispatchCommand(
        design.id,
        envelope(design.id, command),
      );
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      if (result.code !== "PCB_ZONE_NOT_FOUND") throw new Error(result.code);
      expect(result.zoneId).toBe("nope");
    }
  });
});

/**
 * Zone cutouts (docs/pcb-hardening/04-copper-pour-contract.md §11) through the
 * two writing commands: the executor runs the SAME `zoneRegionValidity` the
 * derivation does, so an unusable cutout never reaches persistence.
 */
describe("designer PCB zones — cutouts", () => {
  const HOLE: PcbPointMm[] = [
    { x: 3, y: 3 },
    { x: 7, y: 3 },
    { x: 7, y: 7 },
    { x: 3, y: 7 },
  ];
  const NESTED: PcbPointMm[] = [
    { x: 4, y: 4 },
    { x: 6, y: 4 },
    { x: 6, y: 6 },
    { x: 4, y: 6 },
  ];

  test("pcb_add_zone persists a cutout and the projection carries it", async () => {
    const { sdk } = await createRuntime("zone-hole-add");
    const design = await sdk.createDesign({ name: "Cutout" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] },
      }),
    );
    expect(result.ok).toBe(true);
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.zones[0]?.region).toEqual({
      kind: "polygon",
      pointsMm: SQUARE,
      holesMm: [HOLE],
    });
  });

  test("pcb_add_zone refuses a cutout that is not strictly inside", async () => {
    const { sdk } = await createRuntime("zone-hole-add-bad");
    const design = await sdk.createDesign({ name: "Cutout" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: {
          kind: "polygon",
          pointsMm: SQUARE,
          holesMm: [HOLE.map((p) => ({ x: p.x + 6, y: p.y }))],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.code !== "INVALID_PCB_ZONE") throw new Error(result.code);
    expect(result.detail).toContain("hole_outside_outer");
  });

  test("pcb_update_zone adds a cutout, and refuses a nested one", async () => {
    const { sdk } = await createRuntime("zone-hole-update");
    const design = await sdk.createDesign({ name: "Cutout" });
    const added = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE },
      }),
    );
    if (!added.ok) throw new Error("add failed");
    const zoneId = added.createdEntityId!;

    const ok = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_update_zone",
        zoneId,
        region: { kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] },
      }),
    );
    expect(ok.ok).toBe(true);

    const bad = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_update_zone",
        zoneId,
        region: {
          kind: "polygon",
          pointsMm: SQUARE,
          holesMm: [HOLE, NESTED],
        },
      }),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    if (bad.code !== "INVALID_PCB_ZONE") throw new Error(bad.code);
    expect(bad.detail).toContain("holes_nested");
    // The refused command left the accepted cutout alone.
    const proj = await sdk.getPcbProjection(design.id);
    expect(
      proj?.zones[0]?.region.kind === "polygon"
        ? proj.zones[0].region.holesMm
        : null,
    ).toEqual([HOLE]);
  });

  test("an empty holesMm list normalises away", async () => {
    const { sdk } = await createRuntime("zone-hole-empty");
    const design = await sdk.createDesign({ name: "Cutout" });
    await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_zone",
        layer: "F.Cu",
        net: { netId: null, netName: null },
        region: { kind: "polygon", pointsMm: SQUARE, holesMm: [] },
      }),
    );
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.zones[0]?.region).toEqual({
      kind: "polygon",
      pointsMm: SQUARE,
    });
  });

  test("the HTTP parser carries holesMm (a field with no arm is dropped)", async () => {
    const { sdk, server } = await createRuntime("zone-hole-http");
    const design = await sdk.createDesign({ name: "Cutout" });
    const response = await postCommand(server, design.id, {
      type: "pcb_add_zone",
      layer: "F.Cu",
      net: { netId: null, netName: null },
      region: { kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] },
    });
    expect(response.status).toBe(200);
    const proj = await sdk.getPcbProjection(design.id);
    expect(
      proj?.zones[0]?.region.kind === "polygon"
        ? proj.zones[0].region.holesMm
        : null,
    ).toEqual([HOLE]);
  });
});
