import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  CoreBackendModuleContext,
  ModuleDbClient,
} from "../../../core/contracts/modules/backend-module";
import {
  applyPatches,
  CommandHistory,
  type EcsPatch,
} from "../../../shared/domain/commands";
import {
  type DesignerCommand,
  type BomOverride,
  type BomOverridePatch,
  type BomProjection,
  type DesignerCommandEnvelope,
  type DesignerDesignRecord,
  type DesignerDesignSummary,
  type DesignerDispatchResult,
  type DesignerHistoryActionResult,
  type DesignerHistorySnapshot,
  type DesignerPcbProjection,
  type DrcReport,
  type DesignerSchematicPreview,
  type DesignerSchematicProjection,
  type DesignerSearchLibraryParams,
  type LibraryComponent,
  type LibraryComponentPlacementDetail,
  type LibraryListTagsOptions,
  type LibrarySDK,
  type LibraryTagStat,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resolveCaptureRuntime } from "./capture";
import type { DispatchCaptureMeta } from "./capture/types";
import { executeDesignerCommand } from "./command-executor";
import {
  linkDesignToCloud as linkToCloud,
  mirrorCommand,
  readLinkPublic,
  unlinkDesign,
} from "./cloud-sync";
import {
  getDrcResult,
  saveDrcResult,
  type SaveDrcOptions,
  type StoredDrcResult,
} from "./drc-results";
import {
  commandLog,
  designHeads,
  drcResults,
  bomOverrides,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicWires,
  schematicPrimitives,
  pcbEntities,
  sessionHistories as sessionHistoryRows,
  cloudLink,
  commentThreads,
  commentMessages,
  commentAttachments,
  commentReactions,
  commentOutbox,
} from "./schema";
import {
  ensurePcbBoardSettings,
  loadPcbFreeHoles,
  loadPcbFreePads,
  loadPcbKeepouts,
  loadPcbOverlayShapes,
  loadPcbOverlayTexts,
  loadPcbPlacements,
  loadPcbTraces,
  loadPcbVias,
  loadPcbZones,
  migrateLegacyBoardFill,
  replacePcbBoardSettings,
  replacePcbFreeHoles,
  replacePcbFreePads,
  replacePcbKeepouts,
  replacePcbOverlayShapes,
  replacePcbOverlayTexts,
  replacePcbPlacements,
  replacePcbTraces,
  replacePcbVias,
  replacePcbZones,
} from "./pcb/pcb-store";
import { loadPcbProjection, netNamesFromSchematic } from "./pcb/pcb-projection";
import {
  historyEmpty,
  historySessionKey,
  summarizeHistory,
} from "./history-state";
import {
  hydrateSessionHistory,
  persistSessionHistorySnapshot,
} from "./history-persistence";
import {
  buildCombinedHistoryPatchSet,
  buildHistoryPatchSet,
  combinedStateFromWorld,
  combinedStateToWorld,
  replaceSchematicProjection,
  type DesignerWorldComponent,
} from "./projection-world";
import {
  loadSchematicPreview,
  loadSchematicProjection,
  mapDesignSummary,
  PREVIEW_SCHEMA_VERSION,
  toDesignRecordFromProjection,
} from "./projection-read";
import { conflict, parseDispatchResultJson } from "./results";
import { listBomOverrides, upsertBomOverride } from "./bom-overrides";
import { buildBomProjection } from "./export/bom/writer";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

function getDb(moduleDb: ModuleDbClient): DbClient {
  return (moduleDb as { db: DbClient }).db;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveLibrarySdk(ctx: CoreBackendModuleContext): LibrarySDK {
  const sdk = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  if (!sdk) {
    throw new Error("LibrarySDK unavailable in designer runtime context");
  }
  return sdk;
}

export interface DesignerStore {
  createDesign(input?: { name?: string }): Promise<DesignerDesignSummary>;
  listDesigns(): Promise<DesignerDesignSummary[]>;
  getDesign(designId: string): Promise<DesignerDesignRecord | null>;
  updateDesign(
    designId: string,
    input: { name: string },
  ): Promise<DesignerDesignSummary | null>;
  deleteDesign(designId: string): Promise<void>;
  getSchematicProjection(
    designId: string,
  ): Promise<DesignerSchematicProjection | null>;
  getPcbProjection(designId: string): Promise<DesignerPcbProjection | null>;
  getBomProjection(designId: string): Promise<BomProjection | null>;
  /** Persist the latest DRC report for a design (upsert). */
  saveDrcResult(
    designId: string,
    report: DrcReport,
    options: SaveDrcOptions,
  ): Promise<void>;
  /** Latest persisted DRC report, or null if never run. */
  getDrcResult(designId: string): Promise<StoredDrcResult | null>;
  listBomOverrides(designId: string): Promise<BomOverride[]>;
  updateBomOverride(
    designId: string,
    refdes: string,
    patch: BomOverridePatch,
  ): Promise<BomOverride | null>;
  searchLibraryComponents(
    params: DesignerSearchLibraryParams,
  ): Promise<LibraryComponent[]>;
  resolveLibraryComponentForPlacement(
    componentId: string,
  ): Promise<LibraryComponentPlacementDetail | null>;
  listLibraryTags(options?: LibraryListTagsOptions): Promise<LibraryTagStat[]>;
  dispatchCommand(
    designId: string,
    envelope: DesignerCommandEnvelope,
    cloud?: { bearer?: string; apiUrl?: string },
    captureMeta?: DispatchCaptureMeta,
  ): Promise<DesignerDispatchResult>;
  linkDesignToCloud(
    designId: string,
    cloud: {
      bearer: string;
      apiUrl: string;
      existingCloudDesignId?: string;
      lastSyncedRevision?: number;
    },
  ): Promise<{ cloudDesignId: string; workspaceId: string; userId: string }>;
  getCloudLink(designId: string): Promise<{
    cloudDesignId: string;
    workspaceId: string;
    userId: string;
    lastSyncedRevision: number;
    linkedAt: string;
    failedAttempts: number;
    lastError: string | null;
  } | null>;
  unlinkDesignFromCloud(designId: string): Promise<void>;
  getHistory(
    designId: string,
    sessionId: string,
  ): Promise<DesignerHistorySnapshot>;
  undo(
    designId: string,
    sessionId: string,
  ): Promise<DesignerHistoryActionResult>;
  redo(
    designId: string,
    sessionId: string,
  ): Promise<DesignerHistoryActionResult>;
}

export function createDesignerStore(
  ctx: CoreBackendModuleContext,
): DesignerStore {
  const db = getDb(ctx.db);
  // Process-wide singleton: both store instances (sdk.ts / routes.ts) feed one
  // capture log + registry. No-op when the dataset.capture flag is off.
  const capture = resolveCaptureRuntime(ctx);
  const sessionHistories = new Map<
    string,
    CommandHistory<DesignerCommand, DesignerWorldComponent>
  >();

  function resolveSessionHistory(
    designId: string,
    sessionId: string,
  ): CommandHistory<DesignerCommand, DesignerWorldComponent> {
    const key = historySessionKey(designId, sessionId);
    const existing = sessionHistories.get(key);
    if (existing) {
      return existing;
    }
    const created = new CommandHistory<DesignerCommand, DesignerWorldComponent>(
      200,
    );
    hydrateSessionHistory(db, designId, sessionId, created);
    sessionHistories.set(key, created);
    return created;
  }

  /** Return the cached schematic preview for a design head, recomputing and
   *  persisting it only when the stored snapshot is missing or its embedded
   *  revision has fallen behind the head revision. Keeps Home thumbnails from
   *  re-deriving geometry on every read while staying correct across commands,
   *  undo/redo, and imports (all bump `revision`). */
  function readOrRefreshPreview(
    row: typeof designHeads.$inferSelect,
  ): DesignerSchematicPreview | null {
    if (row.schematicPreviewJson) {
      try {
        const cached = JSON.parse(
          row.schematicPreviewJson,
        ) as DesignerSchematicPreview;
        if (
          cached.revision === row.revision &&
          cached.schemaVersion === PREVIEW_SCHEMA_VERSION
        )
          return cached;
      } catch {
        // Corrupt cache — fall through and recompute.
      }
    }
    const preview = loadSchematicPreview(db, row.id);
    if (preview) {
      db.update(designHeads)
        .set({ schematicPreviewJson: JSON.stringify(preview) })
        .where(eq(designHeads.id, row.id))
        .run();
    }
    return preview;
  }

  function persistSessionHistory(designId: string, sessionId: string): void {
    const history = resolveSessionHistory(designId, sessionId);
    persistSessionHistorySnapshot({
      db,
      designId,
      sessionId,
      history,
      timestamp: nowIso(),
    });
  }

  function applyHistoryPatches(
    designId: string,
    patches: EcsPatch<DesignerWorldComponent>[],
  ): number | null {
    const timestamp = nowIso();
    return ctx.db.transaction((txRaw) => {
      const tx = txRaw as DbClient;
      const current = loadSchematicProjection(tx, designId);
      if (!current) {
        return null;
      }
      // History replay rewrites board settings from the world snapshot, so the
      // legacy fill keys must become board zone rows first (contract §12.1).
      migrateLegacyBoardFill(
        tx,
        designId,
        netNamesFromSchematic(current),
        timestamp,
      );
      const pcb = ensurePcbBoardSettings(tx, designId, timestamp);
      const placements = loadPcbPlacements(tx, designId);
      const traces = loadPcbTraces(tx, designId);
      const vias = loadPcbVias(tx, designId);
      const freeHoles = loadPcbFreeHoles(tx, designId);
      const freePads = loadPcbFreePads(tx, designId);
      const overlayTexts = loadPcbOverlayTexts(tx, designId);
      const overlayShapes = loadPcbOverlayShapes(tx, designId);
      const zones = loadPcbZones(tx, designId).zones;
      const keepouts = loadPcbKeepouts(tx, designId);
      const nextRevision = current.revision + 1;
      const world = combinedStateToWorld({
        schematic: current,
        pcb,
        placements,
        traces,
        vias,
        freeHoles,
        freePads,
        overlayTexts,
        overlayShapes,
        zones,
        keepouts,
      });
      applyPatches(world, patches);
      const next = combinedStateFromWorld(designId, nextRevision, world);
      replaceSchematicProjection(tx, designId, next.schematic, timestamp);
      // viewState / activeLayer / visibleLayers are intentionally stripped
      // from the world snapshot (see combinedStateToWorld) so undo never
      // reverts the user's current display configuration or active layer.
      // Re-attach the live values from the DB before persisting the
      // post-undo board settings — parseBoardSettings treats a missing
      // activeLayer as an invalid payload and would reset to defaults.
      replacePcbBoardSettings(
        tx,
        designId,
        {
          ...next.pcb,
          viewState: pcb.viewState,
          activeLayer: pcb.activeLayer,
          visibleLayers: pcb.visibleLayers,
        },
        timestamp,
      );
      replacePcbPlacements(tx, designId, next.placements, timestamp);
      replacePcbTraces(tx, designId, next.traces, timestamp);
      replacePcbVias(tx, designId, next.vias, timestamp);
      replacePcbFreeHoles(tx, designId, next.freeHoles, timestamp);
      replacePcbFreePads(tx, designId, next.freePads, timestamp);
      replacePcbOverlayTexts(tx, designId, next.overlayTexts, timestamp);
      replacePcbOverlayShapes(tx, designId, next.overlayShapes, timestamp);
      replacePcbZones(tx, designId, next.zones, timestamp);
      replacePcbKeepouts(tx, designId, next.keepouts, timestamp);
      return nextRevision;
    });
  }

  return {
    async createDesign(input) {
      const id = crypto.randomUUID();
      const timestamp = nowIso();
      const name = input?.name?.trim() || "Untitled Design";

      ctx.db.transaction((txRaw) => {
        const tx = txRaw as DbClient;
        tx.insert(designHeads)
          .values({
            id,
            name,
            revision: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
        ensurePcbBoardSettings(tx, id, timestamp);
      });

      return {
        id,
        name,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },

    async listDesigns() {
      const rows = db
        .select()
        .from(designHeads)
        .orderBy(asc(designHeads.createdAt))
        .all();
      const drcByDesign = new Map(
        db
          .select()
          .from(drcResults)
          .all()
          .map((r) => [r.designId, r] as const),
      );
      return rows.map((row) => ({
        ...mapDesignSummary(row, drcByDesign.get(row.id)),
        schematicPreview: readOrRefreshPreview(row),
      }));
    },

    async getDesign(designId) {
      const head = db
        .select()
        .from(designHeads)
        .where(eq(designHeads.id, designId))
        .get();
      if (!head) {
        return null;
      }

      const projection = loadSchematicProjection(db, designId);
      if (!projection) {
        return null;
      }

      const drcRow = db
        .select()
        .from(drcResults)
        .where(eq(drcResults.designId, designId))
        .get();
      return toDesignRecordFromProjection(
        mapDesignSummary(head, drcRow ?? null),
        projection,
      );
    },

    async updateDesign(designId, input) {
      const name = input.name;
      const timestamp = nowIso();
      const updated = ctx.db.transaction((txRaw) => {
        const tx = txRaw as DbClient;
        const head = tx
          .select()
          .from(designHeads)
          .where(eq(designHeads.id, designId))
          .get();
        if (!head) {
          return null;
        }
        tx.update(designHeads)
          .set({ name, updatedAt: timestamp })
          .where(eq(designHeads.id, designId))
          .run();
        return {
          ...head,
          name,
          updatedAt: timestamp,
        };
      });

      if (!updated) {
        return null;
      }
      return mapDesignSummary(updated);
    },

    async deleteDesign(designId) {
      // Delete every per-design row in ONE transaction so a mid-delete failure
      // rolls back cleanly and no orphan rows survive (children before parents,
      // head last). Covers all designer tables keyed by designId.
      ctx.db.transaction((txRaw) => {
        const tx = txRaw as DbClient;
        tx.delete(commentReactions)
          .where(eq(commentReactions.designId, designId))
          .run();
        tx.delete(commentAttachments)
          .where(eq(commentAttachments.designId, designId))
          .run();
        tx.delete(commentMessages)
          .where(eq(commentMessages.designId, designId))
          .run();
        tx.delete(commentOutbox)
          .where(eq(commentOutbox.designId, designId))
          .run();
        tx.delete(commentThreads)
          .where(eq(commentThreads.designId, designId))
          .run();
        tx.delete(schematicPins)
          .where(eq(schematicPins.designId, designId))
          .run();
        tx.delete(schematicWires)
          .where(eq(schematicWires.designId, designId))
          .run();
        tx.delete(schematicLabels)
          .where(eq(schematicLabels.designId, designId))
          .run();
        tx.delete(schematicPrimitives)
          .where(eq(schematicPrimitives.designId, designId))
          .run();
        tx.delete(schematicParts)
          .where(eq(schematicParts.designId, designId))
          .run();
        tx.delete(pcbEntities).where(eq(pcbEntities.designId, designId)).run();
        tx.delete(drcResults).where(eq(drcResults.designId, designId)).run();
        tx.delete(bomOverrides)
          .where(eq(bomOverrides.designId, designId))
          .run();
        tx.delete(commandLog).where(eq(commandLog.designId, designId)).run();
        tx.delete(sessionHistoryRows)
          .where(eq(sessionHistoryRows.designId, designId))
          .run();
        tx.delete(cloudLink).where(eq(cloudLink.designId, designId)).run();
        tx.delete(designHeads).where(eq(designHeads.id, designId)).run();
      });
    },

    async getSchematicProjection(designId) {
      return loadSchematicProjection(db, designId);
    },

    async getPcbProjection(designId) {
      const head = db
        .select()
        .from(designHeads)
        .where(eq(designHeads.id, designId))
        .get();
      if (!head) return null;
      return loadPcbProjection({
        db,
        designId,
        revision: head.revision,
        timestamp: nowIso(),
      });
    },

    async getBomProjection(designId) {
      const schematic = loadSchematicProjection(db, designId);
      const head = db
        .select()
        .from(designHeads)
        .where(eq(designHeads.id, designId))
        .get();
      if (!head) return null;
      const pcb = loadPcbProjection({
        db,
        designId,
        revision: head.revision,
        timestamp: nowIso(),
      });
      return buildBomProjection(pcb, schematic, listBomOverrides(db, designId));
    },

    async saveDrcResult(designId, report, options) {
      saveDrcResult(db, designId, report, options, nowIso());
    },

    async getDrcResult(designId) {
      return getDrcResult(db, designId);
    },

    async listBomOverrides(designId) {
      return listBomOverrides(db, designId);
    },

    async updateBomOverride(designId, refdes, patch) {
      const head = db
        .select()
        .from(designHeads)
        .where(eq(designHeads.id, designId))
        .get();
      if (!head) return null;
      return upsertBomOverride(db, designId, refdes, patch, nowIso());
    },

    async searchLibraryComponents(params) {
      const library = resolveLibrarySdk(ctx);
      return library.searchComponents({
        query: params.query,
        tags: params.tags,
        limit: params.limit,
      });
    },

    async resolveLibraryComponentForPlacement(componentId) {
      const library = resolveLibrarySdk(ctx);
      return library.resolveComponentForPlacement(componentId);
    },

    async listLibraryTags(options) {
      const library = resolveLibrarySdk(ctx);
      return library.listTags(options);
    },

    async dispatchCommand(designId, envelope, cloud, captureMeta) {
      const existingLog = db
        .select()
        .from(commandLog)
        .where(eq(commandLog.commandId, envelope.commandId))
        .get();
      if (existingLog) {
        if (
          existingLog.designId !== designId ||
          existingLog.sessionId !== envelope.sessionId ||
          existingLog.commandType !== envelope.command.type ||
          existingLog.commandJson !== JSON.stringify(envelope.command)
        ) {
          return conflict(envelope.baseRevision, existingLog.appliedRevision);
        }

        const parsed = parseDispatchResultJson(existingLog.resultJson);
        if (parsed) {
          if (parsed.ok) {
            return {
              ...parsed,
              idempotent: true,
            };
          }
          return parsed;
        }

        return conflict(envelope.baseRevision, existingLog.appliedRevision);
      }

      const placeComponentDetail =
        envelope.command.type === "place_part"
          ? await this.resolveLibraryComponentForPlacement(
              envelope.command.componentId,
            )
          : null;

      const pendingHistoryRef: {
        current: {
          revision: number;
          createdEntityId: string | null;
          forwardPatches: EcsPatch<DesignerWorldComponent>[];
          inversePatches: EcsPatch<DesignerWorldComponent>[];
        } | null;
      } = { current: null };

      try {
        const result = ctx.db.transaction((txRaw) => {
          const tx = txRaw as DbClient;
          const head = tx
            .select()
            .from(designHeads)
            .where(eq(designHeads.id, designId))
            .get();
          if (!head) {
            const missingResult = conflict(envelope.baseRevision, -1);
            tx.insert(commandLog)
              .values({
                commandId: envelope.commandId,
                designId,
                sessionId: envelope.sessionId,
                commandType: envelope.command.type,
                commandJson: JSON.stringify(envelope.command),
                resultJson: JSON.stringify(missingResult),
                issuedAt: Math.trunc(envelope.issuedAt),
                appliedRevision: -1,
                createdAt: nowIso(),
              })
              .run();
            return missingResult;
          }

          if (
            envelope.baseRevision !== null &&
            envelope.baseRevision !== head.revision
          ) {
            const conflictResult = conflict(
              envelope.baseRevision,
              head.revision,
            );
            tx.insert(commandLog)
              .values({
                commandId: envelope.commandId,
                designId,
                sessionId: envelope.sessionId,
                commandType: envelope.command.type,
                commandJson: JSON.stringify(envelope.command),
                resultJson: JSON.stringify(conflictResult),
                issuedAt: Math.trunc(envelope.issuedAt),
                appliedRevision: head.revision,
                createdAt: nowIso(),
              })
              .run();
            return conflictResult;
          }

          const projection = loadSchematicProjection(tx, designId);
          if (!projection) {
            const missingResult = conflict(
              envelope.baseRevision,
              head.revision,
            );
            tx.insert(commandLog)
              .values({
                commandId: envelope.commandId,
                designId,
                sessionId: envelope.sessionId,
                commandType: envelope.command.type,
                commandJson: JSON.stringify(envelope.command),
                resultJson: JSON.stringify(missingResult),
                issuedAt: Math.trunc(envelope.issuedAt),
                appliedRevision: head.revision,
                createdAt: nowIso(),
              })
              .run();
            return missingResult;
          }

          const timestamp = nowIso();
          const command = envelope.command;
          const isPcbCommand = command.type.startsWith("pcb_");
          // Lazy legacy board-fill migration (contract §12.1) BEFORE the
          // before-snapshot: every settings writer re-serialises the parsed
          // record, which would drop the unread legacy keys unread.
          migrateLegacyBoardFill(
            tx,
            designId,
            netNamesFromSchematic(projection),
            timestamp,
          );
          const pcbBefore_ = isPcbCommand
            ? ensurePcbBoardSettings(tx, designId, timestamp)
            : null;
          const placementsBefore = isPcbCommand
            ? loadPcbPlacements(tx, designId)
            : null;
          const tracesBefore = isPcbCommand
            ? loadPcbTraces(tx, designId)
            : null;
          const viasBefore = isPcbCommand ? loadPcbVias(tx, designId) : null;
          const freeHolesBefore = isPcbCommand
            ? loadPcbFreeHoles(tx, designId)
            : null;
          const freePadsBefore = isPcbCommand
            ? loadPcbFreePads(tx, designId)
            : null;
          const overlayTextsBefore = isPcbCommand
            ? loadPcbOverlayTexts(tx, designId)
            : null;
          const overlayShapesBefore = isPcbCommand
            ? loadPcbOverlayShapes(tx, designId)
            : null;
          const zonesBefore = isPcbCommand
            ? loadPcbZones(tx, designId).zones
            : null;
          const keepoutsBefore = isPcbCommand
            ? loadPcbKeepouts(tx, designId)
            : null;
          // The rows above, handed to the copper commit gate (contract 07 §6)
          // so it never loads a projection inside the transaction.
          const pcbBefore =
            pcbBefore_ && placementsBefore && tracesBefore && viasBefore &&
            freeHolesBefore && freePadsBefore && zonesBefore && keepoutsBefore
              ? {
                  board: pcbBefore_,
                  placements: placementsBefore,
                  traces: tracesBefore,
                  vias: viasBefore,
                  freeHoles: freeHolesBefore,
                  freePads: freePadsBefore,
                  zones: zonesBefore,
                  keepouts: keepoutsBefore,
                }
              : undefined;
          const result = executeDesignerCommand({
            tx,
            designId,
            revision: head.revision,
            command,
            projection,
            timestamp,
            placeComponentDetail,
            ...(pcbBefore ? { pcbBefore } : {}),
          });

          // View-only commands mutate display state in board_settings.viewState
          // but are not undoable — debounced slider drags would otherwise spam
          // the undo stack. Skip patch capture; the command still bumps the
          // revision so the projection refreshes.
          const isViewOnlyCommand = command.type === "pcb_set_view_state";

          if (result.ok && !isViewOnlyCommand) {
            const nextProjection = loadSchematicProjection(tx, designId);
            if (nextProjection) {
              if (pcbBefore_) {
                const pcbAfter = ensurePcbBoardSettings(
                  tx,
                  designId,
                  timestamp,
                );
                const placementsAfter = loadPcbPlacements(tx, designId);
                const tracesAfter = loadPcbTraces(tx, designId);
                const viasAfter = loadPcbVias(tx, designId);
                const freeHolesAfter = loadPcbFreeHoles(tx, designId);
                const freePadsAfter = loadPcbFreePads(tx, designId);
                const overlayTextsAfter = loadPcbOverlayTexts(tx, designId);
                const overlayShapesAfter = loadPcbOverlayShapes(tx, designId);
                const zonesAfter = loadPcbZones(tx, designId).zones;
                const keepoutsAfter = loadPcbKeepouts(tx, designId);
                const patchSet = buildCombinedHistoryPatchSet(
                  {
                    schematic: projection,
                    pcb: pcbBefore_,
                    placements: placementsBefore ?? [],
                    traces: tracesBefore ?? [],
                    vias: viasBefore ?? [],
                    freeHoles: freeHolesBefore ?? [],
                    freePads: freePadsBefore ?? [],
                    overlayTexts: overlayTextsBefore ?? [],
                    overlayShapes: overlayShapesBefore ?? [],
                    zones: zonesBefore ?? [],
                    keepouts: keepoutsBefore ?? [],
                  },
                  {
                    schematic: nextProjection,
                    pcb: pcbAfter,
                    placements: placementsAfter,
                    traces: tracesAfter,
                    vias: viasAfter,
                    freeHoles: freeHolesAfter,
                    freePads: freePadsAfter,
                    overlayTexts: overlayTextsAfter,
                    overlayShapes: overlayShapesAfter,
                    zones: zonesAfter,
                    keepouts: keepoutsAfter,
                  },
                );
                if (patchSet.forwardPatches.length > 0) {
                  pendingHistoryRef.current = {
                    revision: result.revision,
                    createdEntityId: result.createdEntityId,
                    forwardPatches: patchSet.forwardPatches,
                    inversePatches: patchSet.inversePatches,
                  };
                }
              } else {
                const patchSet = buildHistoryPatchSet(
                  projection,
                  nextProjection,
                );
                if (patchSet.forwardPatches.length > 0) {
                  pendingHistoryRef.current = {
                    revision: result.revision,
                    createdEntityId: result.createdEntityId,
                    forwardPatches: patchSet.forwardPatches,
                    inversePatches: patchSet.inversePatches,
                  };
                }
              }
            }
          }

          tx.insert(commandLog)
            .values({
              commandId: envelope.commandId,
              designId,
              sessionId: envelope.sessionId,
              commandType: command.type,
              commandJson: JSON.stringify(command),
              resultJson: JSON.stringify(result),
              issuedAt: Math.trunc(envelope.issuedAt),
              appliedRevision: result.ok ? result.revision : head.revision,
              createdAt: timestamp,
            })
            .run();

          return result;
        });

        const pendingHistory = pendingHistoryRef.current;
        if (pendingHistory) {
          const history = resolveSessionHistory(designId, envelope.sessionId);
          history.record({
            envelope,
            revision: pendingHistory.revision,
            forwardPatches: pendingHistory.forwardPatches,
            inversePatches: pendingHistory.inversePatches,
            createdEntityId: pendingHistory.createdEntityId,
            timestamp: envelope.issuedAt,
          });
          persistSessionHistory(designId, envelope.sessionId);
        }

        // Dataset capture (WP-D4): verbatim envelope + result + derived tags,
        // and AutoCopperRegistry maintenance. Fail-isolated inside the runtime.
        capture.onCommandApplied({
          designId,
          envelope,
          result,
          meta: captureMeta,
          forwardPatches: pendingHistory?.forwardPatches ?? [],
          inversePatches: pendingHistory?.inversePatches ?? [],
        });

        // Cloud mirror — fire-and-forget; never blocks local writes.
        if (result.ok && cloud?.bearer && cloud?.apiUrl) {
          void mirrorCommand(db, ctx.logger, {
            designId,
            envelope,
            newRevision: result.revision,
            createdEntityId: result.createdEntityId ?? null,
            placeComponentDetail,
            ctx: { cloudBearer: cloud.bearer, cloudApiUrl: cloud.apiUrl },
          });
        }

        return result;
      } catch (error) {
        // The returned shape stays a conflict — a caller retrying is the right
        // recovery either way — but a THROW is not a conflict: an aborted
        // transaction (a DRC kernel throw inside the commit gate, a constraint)
        // would otherwise be indistinguishable from a lost race, with nothing
        // in the log to attribute it to.
        ctx.logger.error("designer: dispatchCommand threw", {
          designId,
          commandId: envelope.commandId,
          commandType: envelope.command.type,
          error: error instanceof Error ? error.message : String(error),
        });
        const racedLog = db
          .select()
          .from(commandLog)
          .where(eq(commandLog.commandId, envelope.commandId))
          .get();
        if (racedLog) {
          const racedResult = parseDispatchResultJson(racedLog.resultJson);
          if (racedResult) {
            if (racedResult.ok) {
              return {
                ...racedResult,
                idempotent: true,
              };
            }
            return racedResult;
          }
        }

        return conflict(envelope.baseRevision, -1);
      }
    },

    async getHistory(designId, sessionId) {
      const history = resolveSessionHistory(designId, sessionId);
      return summarizeHistory(history);
    },

    async undo(designId, sessionId) {
      const history = resolveSessionHistory(designId, sessionId);
      const entry = history.consumeUndo();
      if (!entry) {
        return historyEmpty("undo", summarizeHistory(history));
      }

      const revision = applyHistoryPatches(designId, entry.inversePatches);
      if (revision === null) {
        return historyEmpty("undo", summarizeHistory(history));
      }

      persistSessionHistory(designId, sessionId);
      capture.onHistoryReplay({
        designId,
        editorSessionId: sessionId,
        direction: "undo",
        commandId: entry.envelope.commandId,
        revision,
        forwardPatches: entry.forwardPatches,
        inversePatches: entry.inversePatches,
      });
      return {
        ok: true,
        revision,
        history: summarizeHistory(history),
      };
    },

    async redo(designId, sessionId) {
      const history = resolveSessionHistory(designId, sessionId);
      const entry = history.consumeRedo();
      if (!entry) {
        return historyEmpty("redo", summarizeHistory(history));
      }

      const revision = applyHistoryPatches(designId, entry.forwardPatches);
      if (revision === null) {
        return historyEmpty("redo", summarizeHistory(history));
      }

      persistSessionHistory(designId, sessionId);
      capture.onHistoryReplay({
        designId,
        editorSessionId: sessionId,
        direction: "redo",
        commandId: entry.envelope.commandId,
        revision,
        forwardPatches: entry.forwardPatches,
        inversePatches: entry.inversePatches,
      });
      return {
        ok: true,
        revision,
        history: summarizeHistory(history),
      };
    },

    async linkDesignToCloud(designId, cloud) {
      const head = db
        .select()
        .from(designHeads)
        .where(eq(designHeads.id, designId))
        .get();
      if (!head) {
        throw new Error(`design ${designId} not found`);
      }
      return linkToCloud(db, {
        designId,
        designName: head.name,
        bearer: cloud.bearer,
        apiUrl: cloud.apiUrl,
        existingCloudDesignId: cloud.existingCloudDesignId,
        lastSyncedRevision: cloud.lastSyncedRevision,
      });
    },

    async getCloudLink(designId) {
      return readLinkPublic(db, designId);
    },

    async unlinkDesignFromCloud(designId) {
      unlinkDesign(db, designId);
    },
  };
}
