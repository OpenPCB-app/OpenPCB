/**
 * The one-time legacy board-fill migration (zone/keepout contract §12.1): the
 * per-layer copper-fill view state becomes persisted `board:<layer>` zone rows,
 * the three legacy keys are stripped from the RAW board-settings payload, and
 * nothing else about the design moves — no revision bump, no lost settings.
 *
 * The unit cases run against an in-memory `designer_pcb_entities`; the last two
 * go through the real runtime + SDK so the projection entry point is covered.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import os from "node:os";
import path from "node:path";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import {
  ensurePcbBoardSettings,
  insertPcbZone,
  loadPcbZones,
  migrateLegacyBoardFill,
  readRawBoardSettingsRow,
} from "../../../modules/designer/backend/pcb/pcb-store";
import { pcbEntities } from "../../../modules/designer/backend/schema";
import type { DesignerSDK, PcbZone } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { collectCopperZones } from "../../../shared/pcb-areas/copper-zones";
import { resetSharedSqliteForTesting, getSharedDb } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MentionRegistry } from "../mentions";

type PcbDb = Parameters<typeof migrateLegacyBoardFill>[0];

const TS = "2026-01-01T00:00:00.000Z";
const NO_NETS = new Map<string, string>();

function makeDb(): PcbDb {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE designer_pcb_entities (
      id TEXT PRIMARY KEY NOT NULL,
      design_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite) as unknown as PcbDb;
}

/** Write a raw `board_settings` payload, bypassing every parser. */
function seedRawBoardSettings(
  db: PcbDb,
  designId: string,
  raw: Record<string, unknown>,
): void {
  db.insert(pcbEntities)
    .values({
      id: crypto.randomUUID(),
      designId,
      kind: "board_settings",
      payloadJson: JSON.stringify(raw),
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
}

/** A pre-S3b payload: real settings plus the three legacy view-state keys. */
function legacyPayload(
  fillLayers: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const settings = createDefaultPcbBoardSettings(TS) as unknown as Record<
    string,
    unknown
  >;
  return {
    ...settings,
    ...extra,
    viewState: {
      ...(settings.viewState as Record<string, unknown>),
      copperFillLayers: fillLayers,
      copperFillPourNetIds: Object.fromEntries(
        fillLayers.map((layer) => [layer, "ephemeral-net-id"]),
      ),
      copperFillPadConnection: "solid",
      ...((extra.viewState as Record<string, unknown>) ?? {}),
    },
  };
}

function boardRows(db: PcbDb, designId: string): PcbZone[] {
  return loadPcbZones(db, designId).zones.filter(
    (zone) => zone.region.kind === "board",
  );
}

describe("migrateLegacyBoardFill", () => {
  test("legacy fill layers become board rows and the keys are stripped", () => {
    const db = makeDb();
    seedRawBoardSettings(db, "d1", legacyPayload(["F.Cu", "B.Cu"]));

    expect(migrateLegacyBoardFill(db, "d1", NO_NETS, TS)).toBe(true);

    expect(boardRows(db, "d1")).toEqual([
      {
        id: "board:F.Cu",
        name: null,
        enabled: true,
        lockedAt: null,
        layer: "F.Cu",
        netId: null,
        netName: "GND",
        region: { kind: "board" },
        priority: 0,
        padConnection: "solid",
      },
      {
        id: "board:B.Cu",
        name: null,
        enabled: true,
        lockedAt: null,
        layer: "B.Cu",
        netId: null,
        netName: "GND",
        region: { kind: "board" },
        priority: 0,
        padConnection: "solid",
      },
    ]);

    const viewState = readRawBoardSettingsRow(db, "d1")?.raw
      .viewState as Record<string, unknown>;
    expect(viewState.copperFillLayers).toBeUndefined();
    expect(viewState.copperFillPourNetIds).toBeUndefined();
    expect(viewState.copperFillPadConnection).toBeUndefined();
  });

  test("the ground net's real NAME is persisted, not its ephemeral id", () => {
    const db = makeDb();
    seedRawBoardSettings(db, "d1", legacyPayload(["F.Cu"]));
    migrateLegacyBoardFill(db, "d1", new Map([["n7", "VSS"]]), TS);
    expect(boardRows(db, "d1").map((z) => [z.netId, z.netName])).toEqual([
      [null, "VSS"],
    ]);
  });

  test('with no ground net the hint is "GND" (pours nothing until one exists)', () => {
    const db = makeDb();
    seedRawBoardSettings(db, "d1", legacyPayload(["F.Cu"]));
    migrateLegacyBoardFill(db, "d1", new Map([["n1", "VCC"]]), TS);
    expect(boardRows(db, "d1").map((z) => z.netName)).toEqual(["GND"]);
  });

  test("a fill layer off the stackup is dropped", () => {
    const db = makeDb();
    // Default layerCount is 2, so In1.Cu has no plane to migrate onto.
    seedRawBoardSettings(db, "d1", legacyPayload(["F.Cu", "In1.Cu"]));
    migrateLegacyBoardFill(db, "d1", NO_NETS, TS);
    expect(boardRows(db, "d1").map((z) => z.id)).toEqual(["board:F.Cu"]);
  });

  test("idempotent: a second call reports nothing to do and adds no row", () => {
    const db = makeDb();
    seedRawBoardSettings(db, "d1", legacyPayload(["F.Cu"]));
    expect(migrateLegacyBoardFill(db, "d1", NO_NETS, TS)).toBe(true);
    expect(migrateLegacyBoardFill(db, "d1", NO_NETS, TS)).toBe(false);
    expect(boardRows(db, "d1")).toHaveLength(1);
  });

  test("an existing board:<layer> row is never duplicated or overwritten", () => {
    const db = makeDb();
    seedRawBoardSettings(db, "d1", legacyPayload(["F.Cu", "B.Cu"]));
    insertPcbZone(
      db,
      "d1",
      {
        id: "board:F.Cu",
        name: "kept",
        enabled: false,
        lockedAt: null,
        layer: "F.Cu",
        netId: null,
        netName: "VCC",
        region: { kind: "board" },
        priority: 0,
        padConnection: "thermal",
      },
      TS,
    );

    migrateLegacyBoardFill(db, "d1", NO_NETS, TS);

    const rows = boardRows(db, "d1");
    expect(rows.map((z) => z.id).sort()).toEqual(["board:B.Cu", "board:F.Cu"]);
    const front = rows.find((z) => z.id === "board:F.Cu");
    expect(front?.name).toBe("kept");
    expect(front?.enabled).toBe(false);
    expect(front?.padConnection).toBe("thermal");
  });

  test("a polygon row squatting on a board id blocks the insert", () => {
    // The reserved id is checked against EVERY zone row, not just board rows:
    // two rows sharing an id drop both (fail-closed, no copper).
    const db = makeDb();
    seedRawBoardSettings(db, "d1", legacyPayload(["F.Cu"]));
    insertPcbZone(
      db,
      "d1",
      {
        id: "board:F.Cu",
        name: "squatter",
        enabled: true,
        lockedAt: null,
        layer: "F.Cu",
        netId: null,
        netName: null,
        region: {
          kind: "polygon",
          pointsMm: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 5, y: 5 },
          ],
        },
        priority: 0,
      },
      TS,
    );

    migrateLegacyBoardFill(db, "d1", NO_NETS, TS);

    const withId = loadPcbZones(db, "d1").zones.filter(
      (zone) => zone.id === "board:F.Cu",
    );
    expect(withId).toHaveLength(1);
    expect(withId[0]?.region.kind).toBe("polygon");
  });

  test("a design with no legacy keys (or no settings row) is left alone", () => {
    const db = makeDb();
    expect(migrateLegacyBoardFill(db, "missing", NO_NETS, TS)).toBe(false);
    seedRawBoardSettings(db, "d1", {
      ...(createDefaultPcbBoardSettings(TS) as unknown as Record<
        string,
        unknown
      >),
    });
    expect(migrateLegacyBoardFill(db, "d1", NO_NETS, TS)).toBe(false);
    expect(boardRows(db, "d1")).toEqual([]);
  });

  test("two designs each get their own board:F.Cu row (global-PK regression)", () => {
    // `designer_pcb_entities.id` is a GLOBAL primary key: if the entity id were
    // the row id, the second design would fail the UNIQUE constraint.
    const db = makeDb();
    seedRawBoardSettings(db, "d1", legacyPayload(["F.Cu"]));
    seedRawBoardSettings(db, "d2", legacyPayload(["F.Cu"]));
    migrateLegacyBoardFill(db, "d1", NO_NETS, TS);
    migrateLegacyBoardFill(db, "d2", NO_NETS, TS);
    expect(boardRows(db, "d1").map((z) => z.id)).toEqual(["board:F.Cu"]);
    expect(boardRows(db, "d2").map((z) => z.id)).toEqual(["board:F.Cu"]);
  });

  test("a realistic settings payload survives migrate → ensurePcbBoardSettings", () => {
    const db = makeDb();
    const base = createDefaultPcbBoardSettings(TS);
    const raw = legacyPayload(["F.Cu"], {
      layerCount: 4,
      boardThicknessMm: 0.8,
      designRules: {
        ...base.designRules,
        clearance: { ...base.designRules.clearance, traceToTraceMm: 0.3 },
      },
      netClasses: [
        {
          id: "power",
          name: "Power",
          traceWidthMm: 0.5,
          clearanceMm: 0.3,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          netIds: [],
        },
      ],
      // A key no parser reads — it must still be in the payload afterwards.
      futureTopLevelField: { keep: true },
      viewState: {
        layerPreset: "top-side",
        // A v2 id survives; the v1-format one next to it is pruned on read
        // (rule-semantics contract §8).
        drcWaivedViolationIds: [
          "TRACE_WIDTH_MIN-v2-00112233445566ff",
          "TRACE_WIDTH_MIN-abc",
        ],
        futureViewField: 42,
      },
    });
    seedRawBoardSettings(db, "d1", raw);

    expect(migrateLegacyBoardFill(db, "d1", new Map([["g", "GND"]]), TS)).toBe(
      true,
    );
    // Four-layer stackup, so In1.Cu/In2.Cu were simply not in the fill list.
    expect(boardRows(db, "d1").map((z) => z.id)).toEqual(["board:F.Cu"]);

    const afterMigrate = readRawBoardSettingsRow(db, "d1")!.raw;
    expect(afterMigrate.futureTopLevelField).toEqual({ keep: true });
    expect(
      (afterMigrate.viewState as Record<string, unknown>).futureViewField,
    ).toBe(42);

    const settings = ensurePcbBoardSettings(db, "d1", TS);
    expect(settings.layerCount).toBe(4);
    expect(settings.boardThicknessMm).toBe(0.8);
    expect(settings.designRules.clearance.traceToTraceMm).toBe(0.3);
    expect(settings.netClasses.map((c) => c.id)).toEqual(["power"]);
    expect(settings.viewState?.layerPreset).toBe("top-side");
    expect(settings.viewState?.drcWaivedViolationIds).toEqual([
      "TRACE_WIDTH_MIN-v2-00112233445566ff",
    ]);
    // ensurePcbBoardSettings parsed cleanly, so it wrote nothing back and the
    // unknown fields are still on disk.
    expect(readRawBoardSettingsRow(db, "d1")!.raw.futureTopLevelField).toEqual({
      keep: true,
    });
  });
});

// ───────────────────── through the real runtime + SDK ─────────────────────

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createDesignerSdk(testLabel: string): Promise<DesignerSDK> {
  isolateTestDb(testLabel);
  MentionRegistry.init();
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
}

/** Put the three legacy keys back onto a design's persisted board settings. */
function makeDesignLegacy(designId: string, fillLayers: string[]): void {
  const db = getSharedDb() as unknown as PcbDb;
  const row = readRawBoardSettingsRow(db, designId);
  if (!row) throw new Error("no board settings row to make legacy");
  const viewState = (row.raw.viewState ?? {}) as Record<string, unknown>;
  viewState.copperFillLayers = fillLayers;
  viewState.copperFillPourNetIds = Object.fromEntries(
    fillLayers.map((layer) => [layer, "ephemeral-net-id"]),
  );
  viewState.copperFillPadConnection = "solid";
  row.raw.viewState = viewState;
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(row.raw) })
    .where(eq(pcbEntities.id, row.rowId))
    .run();
}

describe("migrateLegacyBoardFill through getPcbProjection", () => {
  test("the migration does not bump the design revision", async () => {
    const sdk = await createDesignerSdk("pcb-board-fill-migration-revision");
    const design = await sdk.createDesign({ name: "legacy" });
    const before = await sdk.getPcbProjection(design.id);
    expect(before).not.toBeNull();

    makeDesignLegacy(design.id, ["F.Cu"]);

    const after = await sdk.getPcbProjection(design.id);
    expect(after?.revision).toBe(before!.revision);
    expect(after?.zones.map((z) => z.id)).toEqual(["board:F.Cu"]);
  });

  test("an unparsable settings payload still migrates its legacy fill keys", async () => {
    // `ensurePcbBoardSettings` resets an unparsable payload to defaults, so it
    // must run AFTER the migration or the legacy keys go out with the reset.
    const sdk = await createDesignerSdk("pcb-board-fill-migration-unparsable");
    const design = await sdk.createDesign({ name: "corrupt" });
    await sdk.getPcbProjection(design.id);
    makeDesignLegacy(design.id, ["F.Cu", "B.Cu"]);

    const db = getSharedDb() as unknown as PcbDb;
    const row = readRawBoardSettingsRow(db, design.id)!;
    // parseBoardSettings rejects a payload with no activeLayer.
    delete row.raw.activeLayer;
    db.update(pcbEntities)
      .set({ payloadJson: JSON.stringify(row.raw) })
      .where(eq(pcbEntities.id, row.rowId))
      .run();

    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.zones.map((z) => z.id).sort()).toEqual([
      "board:B.Cu",
      "board:F.Cu",
    ]);
  });

  test("a dispatched command migrates before it writes settings", async () => {
    // Command dispatch is an entry point of its own: every settings writer
    // re-serialises the parsed record, so the migration has to run first.
    const sdk = await createDesignerSdk("pcb-board-fill-migration-dispatch");
    const design = await sdk.createDesign({ name: "dispatch" });
    await sdk.getPcbProjection(design.id);
    makeDesignLegacy(design.id, ["F.Cu", "B.Cu"]);

    const result = await sdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "migration-dispatch",
      aggregateId: design.id,
      baseRevision: null,
      issuedAt: Date.now(),
      command: { type: "pcb_set_view_state", patch: { viewSide: "bottom" } },
    });
    expect(result.ok).toBe(true);

    // Read the database directly: going through the projection would migrate.
    const db = getSharedDb() as unknown as PcbDb;
    expect(
      boardRows(db, design.id)
        .map((z) => z.id)
        .sort(),
    ).toEqual(["board:B.Cu", "board:F.Cu"]);
    const viewState = readRawBoardSettingsRow(db, design.id)?.raw
      .viewState as Record<string, unknown>;
    expect(viewState.copperFillLayers).toBeUndefined();
    expect(viewState.copperFillPourNetIds).toBeUndefined();
    expect(viewState.copperFillPadConnection).toBeUndefined();
    expect(viewState.viewSide).toBe("bottom");
  });

  test("undo replays over migrated board rows without dropping them", async () => {
    // History replay rewrites board settings AND replaces every zone row from
    // the world snapshot, so the migrated board zones have to be in it.
    const sdk = await createDesignerSdk("pcb-board-fill-migration-undo");
    const design = await sdk.createDesign({ name: "undo" });
    await sdk.getPcbProjection(design.id);
    makeDesignLegacy(design.id, ["F.Cu", "B.Cu"]);

    const session = "migration-undo";
    const add = await sdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: session,
      aggregateId: design.id,
      baseRevision: null,
      issuedAt: Date.now(),
      command: {
        type: "pcb_add_free_hole",
        centerMm: { x: 4, y: 4 },
        drillMm: 2,
      },
    });
    expect(add.ok).toBe(true);
    expect((await sdk.undo(design.id, session)).ok).toBe(true);

    const db = getSharedDb() as unknown as PcbDb;
    expect(
      boardRows(db, design.id)
        .map((z) => z.id)
        .sort(),
    ).toEqual(["board:B.Cu", "board:F.Cu"]);
    const viewState = readRawBoardSettingsRow(db, design.id)?.raw
      .viewState as Record<string, unknown>;
    expect(viewState.copperFillLayers).toBeUndefined();
    const proj = await sdk.getPcbProjection(design.id);
    expect(proj?.freeHoles).toEqual([]);
  });

  test("a migrated legacy design derives the same zones as an authored one", async () => {
    const sdk = await createDesignerSdk("pcb-board-fill-migration-parity");
    const legacy = await sdk.createDesign({ name: "legacy" });
    const authored = await sdk.createDesign({ name: "authored" });
    // Both designs need a real GND net, or both sides derive an empty list and
    // the comparison proves nothing.
    for (const design of [legacy, authored]) {
      const labelled = await sdk.dispatchCommand(design.id, {
        commandId: crypto.randomUUID(),
        sessionId: "migration-parity",
        aggregateId: design.id,
        baseRevision: null,
        issuedAt: Date.now(),
        command: {
          type: "upsert_label",
          text: "GND",
          positionNm: { x: 0, y: 0 },
        },
      });
      expect(labelled.ok).toBe(true);
    }
    await sdk.getPcbProjection(legacy.id);
    await sdk.getPcbProjection(authored.id);

    makeDesignLegacy(legacy.id, ["F.Cu"]);
    insertPcbZone(
      getSharedDb() as unknown as PcbDb,
      authored.id,
      {
        id: "board:F.Cu",
        name: null,
        enabled: true,
        lockedAt: null,
        layer: "F.Cu",
        netId: null,
        netName: "GND",
        region: { kind: "board" },
        priority: 0,
        padConnection: "solid",
      },
      TS,
    );

    const legacyProj = await sdk.getPcbProjection(legacy.id);
    const authoredProj = await sdk.getPcbProjection(authored.id);
    expect(legacyProj?.zones).toEqual(authoredProj!.zones);

    const derive = (proj: typeof legacyProj) =>
      collectCopperZones({
        zones: proj!.zones,
        layerCount: proj!.board.layerCount,
        knownNetIds: new Set(Object.keys(proj!.netNames ?? {})),
      });
    const derived = derive(legacyProj);
    // Non-vacuous: one board zone that actually pours a bound net.
    expect(derived.zones).toHaveLength(1);
    expect(derived.zones[0]?.sourceKind).toBe("board");
    expect(derived.zones[0]?.netId).toBe(
      Object.entries(legacyProj!.netNames).find(
        ([, name]) => name === "GND",
      )![0],
    );
    expect(derived).toEqual(derive(authoredProj));
  });
});
