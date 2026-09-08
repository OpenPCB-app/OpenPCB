/**
 * The three keepout authoring commands (zone/keepout contract §12.2): layer
 * validation and dedupe, ring validity, wholesale `restrictions` replacement,
 * the lock lifecycle, the HTTP parser arms and undo/redo.
 */
import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerSDK,
  PcbKeepoutRestrictions,
  PcbPointMm,
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

const SESSION = "keepouts-session";
let commandSeq = 0;

function envelope(
  designId: string,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  commandSeq += 1;
  return {
    commandId: `keepout-cmd-${commandSeq}-${crypto.randomUUID()}`,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command,
  };
}

const SQUARE: PcbPointMm[] = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 8 },
  { x: 0, y: 8 },
];
const TRIANGLE: PcbPointMm[] = [
  { x: 2, y: 2 },
  { x: 9, y: 2 },
  { x: 2, y: 9 },
];
const ALL_FORBIDDEN: PcbKeepoutRestrictions = {
  tracks: true,
  vias: true,
  pads: true,
  copperPour: true,
  footprints: true,
};

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
          commandId: `http-keepout-${crypto.randomUUID()}`,
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

describe("designer PCB keepouts — add", () => {
  test("a keepout lands in the projection", async () => {
    const { sdk } = await createRuntime("keepout-add");
    const design = await sdk.createDesign({ name: "Keepout add" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_keepout",
        layers: ["F.Cu", "B.Cu"],
        pointsMm: SQUARE,
        restrictions: ALL_FORBIDDEN,
        name: "No-fly",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.keepouts).toHaveLength(1);
    expect(proj?.keepouts[0]).toMatchObject({
      id: result.createdEntityId!,
      name: "No-fly",
      enabled: true,
      lockedAt: null,
      layers: ["F.Cu", "B.Cu"],
      pointsMm: SQUARE,
      restrictions: ALL_FORBIDDEN,
    });
  });

  test("repeated layers are deduplicated, first occurrence winning", async () => {
    const { sdk } = await createRuntime("keepout-dedupe");
    const design = await sdk.createDesign({ name: "Dedupe" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_keepout",
        layers: ["B.Cu", "F.Cu", "B.Cu"],
        pointsMm: SQUARE,
        restrictions: ALL_FORBIDDEN,
      }),
    );
    expect(result.ok).toBe(true);
    expect(
      (await sdk.getPcbProjection(design.id))?.keepouts[0]?.layers,
    ).toEqual(["B.Cu", "F.Cu"]);
  });

  test.each([
    ["empty", [] as string[], "must not be empty"],
    ["non-copper", ["F.SilkS"], "copper"],
    ["off the stackup", ["In1.Cu"], "stackup"],
  ])("layers %s are refused", async (label, layers, detailFragment) => {
    const { sdk } = await createRuntime(`keepout-layers-${label}`);
    const design = await sdk.createDesign({ name: "Bad layers" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_keepout",
        layers: layers as never,
        pointsMm: SQUARE,
        restrictions: ALL_FORBIDDEN,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.code !== "INVALID_PCB_KEEPOUT") throw new Error(result.code);
    expect(result.detail).toContain(detailFragment);
  });

  test("an invalid ring is refused with its reason", async () => {
    const { sdk } = await createRuntime("keepout-ring");
    const design = await sdk.createDesign({ name: "Bad ring" });
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_keepout",
        layers: ["F.Cu"],
        pointsMm: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
        restrictions: ALL_FORBIDDEN,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.code !== "INVALID_PCB_KEEPOUT") throw new Error(result.code);
    expect(result.detail).toContain("selfIntersecting");
  });
});

describe("designer PCB keepouts — update and delete", () => {
  async function withKeepout(label: string) {
    const { sdk, server } = await createRuntime(label);
    const design = await sdk.createDesign({ name: label });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_keepout",
        layers: ["F.Cu"],
        pointsMm: SQUARE,
        restrictions: ALL_FORBIDDEN,
        name: "K1",
      }),
    );
    if (!add.ok) throw new Error("keepout setup failed");
    return {
      sdk,
      server,
      designId: design.id,
      keepoutId: add.createdEntityId!,
    };
  }

  test("restrictions replace the whole object rather than merging", async () => {
    const { sdk, designId, keepoutId } = await withKeepout("keepout-update");
    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, {
        type: "pcb_update_keepout",
        keepoutId,
        name: "K2",
        enabled: false,
        layers: ["B.Cu"],
        pointsMm: TRIANGLE,
        restrictions: {
          tracks: false,
          vias: true,
          pads: false,
          copperPour: false,
          footprints: false,
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect((await sdk.getPcbProjection(designId))?.keepouts[0]).toMatchObject({
      id: keepoutId,
      name: "K2",
      enabled: false,
      layers: ["B.Cu"],
      pointsMm: TRIANGLE,
      restrictions: {
        tracks: false,
        vias: true,
        pads: false,
        copperPour: false,
        footprints: false,
      },
    });
  });

  test("a locked keepout refuses an unlock bundled with edits", async () => {
    const { sdk, designId, keepoutId } = await withKeepout("keepout-lock-bundle");
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, {
            type: "pcb_update_keepout",
            keepoutId,
            locked: true,
          }),
        )
      ).ok,
    ).toBe(true);
    const bundled = await sdk.dispatchCommand(
      designId,
      envelope(designId, {
        type: "pcb_update_keepout",
        keepoutId,
        locked: false,
        name: "smuggled",
      }),
    );
    expect(bundled.ok).toBe(false);
    if (!bundled.ok && bundled.code === "INVALID_PCB_KEEPOUT") {
      expect(bundled.detail).toContain("unlock first");
    }
    const keepout = (await sdk.getPcbProjection(designId))!.keepouts[0]!;
    expect(keepout.lockedAt).not.toBeNull();
    expect(keepout.name).not.toBe("smuggled");
  });

  test("a locked keepout refuses edits and deletes until unlocked", async () => {
    const { sdk, designId, keepoutId } = await withKeepout("keepout-lock");
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, {
            type: "pcb_update_keepout",
            keepoutId,
            locked: true,
          }),
        )
      ).ok,
    ).toBe(true);

    const edit = await sdk.dispatchCommand(
      designId,
      envelope(designId, {
        type: "pcb_update_keepout",
        keepoutId,
        name: "nope",
      }),
    );
    expect(edit.ok).toBe(false);
    if (!edit.ok && edit.code === "INVALID_PCB_KEEPOUT") {
      expect(edit.detail).toContain("locked");
    }

    const del = await sdk.dispatchCommand(
      designId,
      envelope(designId, { type: "pcb_delete_keepout", keepoutId }),
    );
    expect(del.ok).toBe(false);
    if (!del.ok && del.code === "INVALID_PCB_KEEPOUT") {
      expect(del.detail).toContain("locked");
    }

    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, {
            type: "pcb_update_keepout",
            keepoutId,
            locked: false,
          }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (await sdk.getPcbProjection(designId))?.keepouts[0]?.lockedAt,
    ).toBeNull();
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, { type: "pcb_delete_keepout", keepoutId }),
        )
      ).ok,
    ).toBe(true);
    expect((await sdk.getPcbProjection(designId))?.keepouts).toEqual([]);
  });

  test("an unknown keepout id is PCB_KEEPOUT_NOT_FOUND on update and delete", async () => {
    const { sdk } = await createRuntime("keepout-not-found");
    const design = await sdk.createDesign({ name: "Missing" });
    for (const command of [
      {
        type: "pcb_update_keepout" as const,
        keepoutId: "nope",
        enabled: false,
      },
      { type: "pcb_delete_keepout" as const, keepoutId: "nope" },
    ]) {
      const result = await sdk.dispatchCommand(
        design.id,
        envelope(design.id, command),
      );
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      if (result.code !== "PCB_KEEPOUT_NOT_FOUND") throw new Error(result.code);
      expect(result.keepoutId).toBe("nope");
    }
  });
});

describe("designer PCB keepouts — HTTP parser arms", () => {
  test("every add and update field survives the round trip", async () => {
    const { sdk, server } = await createRuntime("keepout-http");
    const design = await sdk.createDesign({ name: "HTTP keepout" });

    const addResponse = await postCommand(server, design.id, {
      type: "pcb_add_keepout",
      layers: ["F.Cu", "B.Cu"],
      pointsMm: SQUARE,
      restrictions: ALL_FORBIDDEN,
      name: "Full",
      enabled: false,
    });
    expect(addResponse.status).toBe(200);
    const added = (await sdk.getPcbProjection(design.id))!.keepouts[0]!;
    expect(added).toMatchObject({
      layers: ["F.Cu", "B.Cu"],
      pointsMm: SQUARE,
      restrictions: ALL_FORBIDDEN,
      name: "Full",
      enabled: false,
      lockedAt: null,
    });

    const updateResponse = await postCommand(server, design.id, {
      type: "pcb_update_keepout",
      keepoutId: added.id,
      name: "Patched",
      enabled: true,
      layers: ["B.Cu"],
      pointsMm: TRIANGLE,
      // A partial object over the wire: the missing flags parse as false.
      restrictions: { tracks: true, copperPour: true },
      locked: true,
    });
    expect(updateResponse.status).toBe(200);
    const patched = (await sdk.getPcbProjection(design.id))!.keepouts[0]!;
    expect(patched).toMatchObject({
      id: added.id,
      name: "Patched",
      enabled: true,
      layers: ["B.Cu"],
      pointsMm: TRIANGLE,
      restrictions: {
        tracks: true,
        vias: false,
        pads: false,
        copperPour: true,
        footprints: false,
      },
    });
    expect(typeof patched.lockedAt).toBe("string");
  });

  test("a delete round-trips over HTTP", async () => {
    const { sdk, server } = await createRuntime("keepout-http-delete");
    const design = await sdk.createDesign({ name: "HTTP delete" });
    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_keepout",
        layers: ["F.Cu"],
        pointsMm: SQUARE,
        restrictions: ALL_FORBIDDEN,
      }),
    );
    if (!add.ok) return;
    const response = await postCommand(server, design.id, {
      type: "pcb_delete_keepout",
      keepoutId: add.createdEntityId,
    });
    expect(response.status).toBe(200);
    expect((await sdk.getPcbProjection(design.id))?.keepouts).toEqual([]);
  });
});

describe("designer PCB keepouts — history", () => {
  test("add, update and delete each undo and redo", async () => {
    const { sdk } = await createRuntime("keepout-history");
    const design = await sdk.createDesign({ name: "History" });
    const keepouts = async () =>
      (await sdk.getPcbProjection(design.id))!.keepouts;

    const add = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, {
        type: "pcb_add_keepout",
        layers: ["F.Cu"],
        pointsMm: SQUARE,
        restrictions: ALL_FORBIDDEN,
        name: "H1",
      }),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const keepoutId = add.createdEntityId!;

    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect(await keepouts()).toEqual([]);
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect((await keepouts())[0]?.id).toBe(keepoutId);

    expect(
      (
        await sdk.dispatchCommand(
          design.id,
          envelope(design.id, {
            type: "pcb_update_keepout",
            keepoutId,
            name: "H2",
            layers: ["F.Cu", "B.Cu"],
          }),
        )
      ).ok,
    ).toBe(true);
    expect((await keepouts())[0]).toMatchObject({
      name: "H2",
      layers: ["F.Cu", "B.Cu"],
    });
    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect((await keepouts())[0]).toMatchObject({
      name: "H1",
      layers: ["F.Cu"],
    });
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect((await keepouts())[0]).toMatchObject({ name: "H2" });

    expect(
      (
        await sdk.dispatchCommand(
          design.id,
          envelope(design.id, { type: "pcb_delete_keepout", keepoutId }),
        )
      ).ok,
    ).toBe(true);
    expect(await keepouts()).toEqual([]);
    expect((await sdk.undo(design.id, SESSION)).ok).toBe(true);
    expect((await keepouts())[0]).toMatchObject({ id: keepoutId, name: "H2" });
    expect((await sdk.redo(design.id, SESSION)).ok).toBe(true);
    expect(await keepouts()).toEqual([]);
  });
});
