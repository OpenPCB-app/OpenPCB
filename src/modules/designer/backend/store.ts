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
  type DesignerOperationIdentity,
  type DesignerOperationReceipt,
  type DesignerOperationReceiptLookup,
  type DesignerDesignCreationResult,
  type DesignerDesignCreationReceiptLookup,
  type DesignerDesignCreationReceipt,
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
  detectNetMerge,
  getNetMergePolicy,
  NetMergeRefusal,
} from "./net-merge-guard";
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
import { historyEmpty, summarizeHistory } from "./history-state";
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
import { commandTouchesPcb } from "./commands/batch";
import { listBomOverrides, upsertBomOverride } from "./bom-overrides";
import { buildBomProjection } from "./export/bom/writer";
import {
  canonicalJson,
  identityConflict,
  identityMatchesEnvelope,
  operationRowMatches,
  readOperationReceipt,
  listOperationReceipts,
} from "./operation-receipts";
import {
  createDesignOperation,
  readDesignCreationReceipt,
  listDesignCreationReceipts,
} from "./design-creation-receipts";
import { insertDesign } from "./design-initialization";
import { deleteDesignNetIdentity } from "./net-identity/state-store";
import { readNetIdentityState } from "./net-identity/state-store";
import { ensureNetIdentity } from "./net-identity/ensure";
import { resolveIdentityMode } from "./net-identity/mode";
import { syncDispatchedIdentity } from "./net-identity/dispatch-sync";
import { historyIdentityBinding } from "./net-identity/history-binding";
import { applyRawNetRebindDelta } from "./net-identity/rebind-history";
import { buildNetRebindHistoryPatchSet, readNetRebindHistoryDelta } from "./net-identity/rebind-history-patches";
import type { RawNetRebindDelta } from "./net-identity/rebind-history-types";
import { rawNetRebindConflict } from "./net-identity/rebind-history-validation";
import type { DesignerNetIdentityOutcome } from "../../../sdks/designer/net-identity";

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

/**
 * Attach `footprintStale` to every part: the library's current default
 * footprint id or sourceHash differs from the part's snapshot. A component the
 * library no longer has is NOT stale.
 */
async function markStaleFootprints(
  ctx: CoreBackendModuleContext,
  projection: DesignerSchematicProjection,
): Promise<DesignerSchematicProjection> {
  if (projection.parts.length === 0) return projection;
  const refs = await resolveLibrarySdk(ctx).getDefaultFootprintRefs(
    projection.parts.map((part) => part.componentId),
  );
  return {
    ...projection,
    parts: projection.parts.map((part) => {
      const ref = refs[part.componentId];
      const stale =
        !!ref &&
        (ref.footprintId !== part.footprint.footprintId ||
          (ref.sourceHash ?? null) !== (part.footprint.sourceHash ?? null));
      return { ...part, footprintStale: stale };
    }),
  };
}

async function resolveRefreshDetails(
  store: Pick<DesignerStore, "resolveLibraryComponentForPlacement" | "getSchematicProjection">,
  designId: string,
  partIds: readonly string[],
): Promise<Map<string, LibraryComponentPlacementDetail>> {
  const details = new Map<string, LibraryComponentPlacementDetail>();
  const projection = await store.getSchematicProjection(designId);
  if (!projection) return details;
  const wanted = new Set(partIds);
  for (const part of projection.parts) {
    if (!wanted.has(part.id) || details.has(part.componentId)) continue;
    const detail = await store.resolveLibraryComponentForPlacement(
      part.componentId,
    );
    if (detail) details.set(part.componentId, detail);
  }
  return details;
}

export interface DesignerStore {
  createDesign(input?: { name?: string }): Promise<DesignerDesignSummary>;
  createDesignOperation(input: { name?: string }, identity: DesignerOperationIdentity): Promise<DesignerDesignCreationResult>;
  getDesignCreationReceipt(identity: DesignerOperationIdentity): Promise<DesignerDesignCreationReceiptLookup>;
  listDesignCreationReceipts(actorScope: string, operationId: string): Promise<DesignerDesignCreationReceipt[]>;
  listDesigns(): Promise<DesignerDesignSummary[]>;
  getDesign(designId: string): Promise<DesignerDesignRecord | null>;
  /** Just the head row's name — for export file names; null when missing. */
  getDesignName(designId: string): Promise<string | null>;
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
    identity?: DesignerOperationIdentity,
  ): Promise<DesignerDispatchResult>;
  dispatchOperation(
    designId: string,
    envelope: DesignerCommandEnvelope,
    identity: DesignerOperationIdentity,
    captureMeta?: DispatchCaptureMeta,
  ): Promise<DesignerDispatchResult>;
  getOperationReceipt(commandId: string, identity: DesignerOperationIdentity): Promise<DesignerOperationReceiptLookup>;
  listOperationReceipts(actorScope: string, operationId: string): Promise<DesignerOperationReceipt[]>;
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
    expectedRevision?: number,
  ): Promise<DesignerHistoryActionResult>;
  redo(
    designId: string,
    sessionId: string,
    expectedRevision?: number,
  ): Promise<DesignerHistoryActionResult>;
}

export function createDesignerStore(
  ctx: CoreBackendModuleContext,
  hooks?: { afterCommandCommit?: (commandId: string) => void },
): DesignerStore {
  const db = getDb(ctx.db);
  // Process-wide singleton: both store instances (sdk.ts / routes.ts) feed one
  // capture log + registry. No-op when the dataset.capture flag is off.
  const capture = resolveCaptureRuntime(ctx);
  function resolveSessionHistory(
    designId: string,
    sessionId: string,
  ): CommandHistory<DesignerCommand, DesignerWorldComponent> {
    // HTTP and SDK stores share SQLite, not object identity. Always load the committed history.
    const history = new CommandHistory<DesignerCommand, DesignerWorldComponent>(
      200,
    );
    hydrateSessionHistory(db, designId, sessionId, history);
    return history;
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

  function applyHistoryPatches(
    designId: string,
    patches: EcsPatch<DesignerWorldComponent>[],
    sessionId: string,
    history: CommandHistory<DesignerCommand, DesignerWorldComponent>,
    envelope: DesignerCommandEnvelope,
  ): { revision: number; netIdentity?: DesignerNetIdentityOutcome } | null {
    const timestamp = nowIso();
    return ctx.db.transaction((txRaw) => {
      const tx = txRaw as DbClient;
      const rebind = readNetRebindHistoryDelta(designId, envelope?.command?.type ?? "", patches);
      const identity = resolveIdentityMode(tx, designId);
      if (rebind) {
        if (envelope.aggregateId !== designId) rawNetRebindConflict("Repair history belongs to another design");
        if (identity.mode !== "durable") rawNetRebindConflict("Repair history requires durable net identity");
        const head = tx.select({ revision: designHeads.revision }).from(designHeads).where(eq(designHeads.id, designId)).get();
        if (!head) rawNetRebindConflict("Repair history design is missing");
        if (!Number.isSafeInteger(head.revision) || head.revision < 0 || !Number.isSafeInteger(head.revision + 1)) {
          rawNetRebindConflict("Repair history revision is invalid or exhausted");
        }
        applyRawNetRebindDelta(tx, designId, rebind, timestamp);
        const revision = head.revision + 1;
        tx.update(designHeads).set({ revision, updatedAt: timestamp }).where(eq(designHeads.id, designId)).run();
        persistSessionHistorySnapshot({ db: tx, designId, sessionId, history, timestamp });
        return { revision };
      }
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
        { mode: identity.mode === "durable" ? "bound" : "name-hint" },
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
        ...(identity.mode === "durable" ? { activeNetIdentities: identity.state!.active } : {}),
      });
      applyPatches(world, patches);
      const identityReplay = identity.mode === "durable" ? historyIdentityBinding(tx, identity.state!) : null;
      const next = combinedStateFromWorld(designId, nextRevision, world, identityReplay?.binder);
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
      const events = identityReplay?.persist(next, nextRevision, timestamp) ?? [];
      persistSessionHistorySnapshot({ db: tx, designId, sessionId, history, timestamp });
      return { revision: nextRevision, ...(events.length > 0 ? { netIdentity: { events } } : {}) };
    });
  }

  function replayHistory(
    designId: string,
    sessionId: string,
    direction: "undo" | "redo",
    expectedRevision?: number,
  ): DesignerHistoryActionResult {
    ensureNetIdentity(db, designId, ctx.logger);
    const replay = ctx.db.transaction(() => {
      const history = resolveSessionHistory(designId, sessionId);
      const actual =
        db
          .select({ revision: designHeads.revision })
          .from(designHeads)
          .where(eq(designHeads.id, designId))
          .get()?.revision ?? -1;
      if (
        expectedRevision !== undefined &&
        (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      )
        throw new Error("expectedRevision must be a non-negative integer");
      if (expectedRevision !== undefined && actual !== expectedRevision)
        return {
          result: {
            ok: false as const,
            code: "REVISION_CONFLICT" as const,
            direction,
            history: summarizeHistory(history),
            conflict: { expected: expectedRevision, actual },
          },
          entry: null,
        };
      const entry =
        direction === "undo" ? history.consumeUndo() : history.consumeRedo();
      if (!entry)
        return {
          result: historyEmpty(direction, summarizeHistory(history)),
          entry: null,
        };
      // The consumed entry is persisted inside the patch transaction.
      const applied = applyHistoryPatches(
        designId,
        direction === "undo" ? entry.inversePatches : entry.forwardPatches,
        sessionId,
        history,
        entry.envelope,
      );
      if (applied === null)
        return {
          result: historyEmpty(direction, summarizeHistory(history)),
          entry: null,
        };
      return {
        result: {
          ok: true as const,
          ...applied,
          history: summarizeHistory(history),
        },
        entry,
      };
    });
    if (replay.entry && replay.result.ok)
      capture.onHistoryReplay({
        designId,
        editorSessionId: sessionId,
        direction,
        commandId: replay.entry.envelope.commandId,
        revision: replay.result.revision,
        forwardPatches: replay.entry.forwardPatches,
        inversePatches: replay.entry.inversePatches,
      });
    return replay.result;
  }

  return {
    async createDesignOperation(input, identity) {
      const result = createDesignOperation(ctx.db, input, identity);
      if (result.ok) hooks?.afterCommandCommit?.(identity.actionId);
      return result;
    },

    async getDesignCreationReceipt(identity) {
      return readDesignCreationReceipt(db, identity);
    },

    async listDesignCreationReceipts(actorScope, operationId) {
      return listDesignCreationReceipts(db, actorScope, operationId);
    },

    async createDesign(input) {
      const id = crypto.randomUUID();
      const timestamp = nowIso();
      return ctx.db.transaction((txRaw) =>
        insertDesign(txRaw as DbClient, input ?? {}, id, timestamp),
      );
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
      ensureNetIdentity(db, designId, ctx.logger);
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

    async getDesignName(designId) {
      const head = db
        .select({ name: designHeads.name })
        .from(designHeads)
        .where(eq(designHeads.id, designId))
        .get();
      return head?.name ?? null;
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
        deleteDesignNetIdentity(tx, designId);
        tx.delete(designHeads).where(eq(designHeads.id, designId)).run();
      });
    },

    async getSchematicProjection(designId) {
      ensureNetIdentity(db, designId, ctx.logger);
      const projection = loadSchematicProjection(db, designId);
      if (!projection) return null;
      // `footprintStale` needs LibrarySDK, which the pure projection reader
      // does not have — it is attached here, once per read, from one batched
      // lookup over the distinct componentIds.
      return markStaleFootprints(ctx, projection);
    },

    async getPcbProjection(designId) {
      ensureNetIdentity(db, designId, ctx.logger);
      return ctx.db.transaction((txRaw) => {
        const tx = txRaw as DbClient;
        const identityMode = resolveIdentityMode(tx, designId).mode;
        const head = tx.select().from(designHeads).where(eq(designHeads.id, designId)).get();
        if (!head) return null;
        return loadPcbProjection({ db: tx, designId, revision: head.revision, timestamp: nowIso(), identityMode });
      });
    },

    async getBomProjection(designId) {
      ensureNetIdentity(db, designId, ctx.logger);
      return ctx.db.transaction((txRaw) => {
        const tx = txRaw as DbClient;
        const identityMode = resolveIdentityMode(tx, designId).mode;
        const schematic = loadSchematicProjection(tx, designId);
        const head = tx.select().from(designHeads).where(eq(designHeads.id, designId)).get();
        if (!head) return null;
        const pcb = loadPcbProjection({ db: tx, designId, revision: head.revision, timestamp: nowIso(), identityMode });
        return buildBomProjection(pcb, schematic, listBomOverrides(tx, designId));
      });
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

    async dispatchOperation(designId, envelope, identity, captureMeta) {
      if (!identityMatchesEnvelope(designId, envelope, identity)) {
        return identityConflict(envelope.commandId);
      }
      return this.dispatchCommand(designId, envelope, undefined, captureMeta, identity);
    },

    async getOperationReceipt(commandId, identity) {
      return readOperationReceipt(db, commandId, identity);
    },

    async listOperationReceipts(actorScope, operationId) {
      return listOperationReceipts(db, actorScope, operationId);
    },

    async dispatchCommand(designId, envelope, cloud, captureMeta, identity) {
      const replay = (row: typeof commandLog.$inferSelect): DesignerDispatchResult => {
        if (identity || row.operationIdentityJson) {
          if (!identity || !operationRowMatches(row, identity, envelope)) {
            return identityConflict(envelope.commandId);
          }
          return JSON.parse(row.resultJson) as DesignerDispatchResult;
        }
        if (row.designId !== designId || row.sessionId !== envelope.sessionId ||
          row.commandType !== envelope.command.type ||
          row.commandJson !== JSON.stringify(envelope.command)) {
          return conflict(envelope.baseRevision, row.appliedRevision);
        }
        return parseDispatchResultJson(row.resultJson) ?? conflict(envelope.baseRevision, row.appliedRevision);
      };
      if (identity && !identityMatchesEnvelope(designId, envelope, identity)) {
        return identityConflict(envelope.commandId);
      }
      const receiptMetadata = identity ? {
        operationIdentityJson: canonicalJson(identity),
        actorScope: identity.actorScope,
        operationId: identity.operationId,
      } : {};
      const existingLog = db
        .select()
        .from(commandLog)
        .where(eq(commandLog.commandId, envelope.commandId))
        .get();
      if (existingLog) {
        return replay(existingLog);
      }

      const placeComponentDetail =
        envelope.command.type === "place_part"
          ? await this.resolveLibraryComponentForPlacement(
              envelope.command.componentId,
            )
          : null;

      const refreshComponentDetails =
        envelope.command.type === "refresh_part_footprint"
          ? await resolveRefreshDetails(
              this,
              designId,
              envelope.command.partIds,
            )
          : undefined;

      const completedDuringLibraryRead = db.select().from(commandLog)
        .where(eq(commandLog.commandId, envelope.commandId)).get();
      if (completedDuringLibraryRead) return replay(completedDuringLibraryRead);
      ensureNetIdentity(db, designId, ctx.logger);

      const pendingHistoryRef: {
        current: {
          revision: number;
          createdEntityId: string | null;
          forwardPatches: EcsPatch<DesignerWorldComponent>[];
          inversePatches: EcsPatch<DesignerWorldComponent>[];
        } | null;
      } = { current: null };
      const history = resolveSessionHistory(designId, envelope.sessionId);
      const previousHistory = history.snapshot();
      let committed = false;

      try {
        const result = ctx.db.transaction((txRaw) => {
          const tx = txRaw as DbClient;
          // Library resolution above can yield; another caller may commit first.
          const raced = tx.select().from(commandLog)
            .where(eq(commandLog.commandId, envelope.commandId)).get();
          if (raced) return replay(raced);
          const head = tx
            .select()
            .from(designHeads)
            .where(eq(designHeads.id, designId))
            .get();
          if (!head) {
            const missingResult = conflict(envelope.baseRevision, -1);
            tx.insert(commandLog)
              .values({
                ...receiptMetadata,
                commandId: envelope.commandId,
                designId,
                sessionId: envelope.sessionId,
                commandType: envelope.command.type,
                commandJson: identity ? canonicalJson(envelope.command) : JSON.stringify(envelope.command),
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
                ...receiptMetadata,
                commandId: envelope.commandId,
                designId,
                sessionId: envelope.sessionId,
                commandType: envelope.command.type,
                commandJson: identity ? canonicalJson(envelope.command) : JSON.stringify(envelope.command),
                resultJson: JSON.stringify(conflictResult),
                issuedAt: Math.trunc(envelope.issuedAt),
                appliedRevision: head.revision,
                createdAt: nowIso(),
              })
              .run();
            return conflictResult;
          }

          const identityState = resolveIdentityMode(tx, designId);
          const activeBefore = identityState.mode === "durable" ? structuredClone(identityState.state!.active) : undefined;
          const projection = loadSchematicProjection(tx, designId);
          if (!projection) {
            const missingResult = conflict(
              envelope.baseRevision,
              head.revision,
            );
            tx.insert(commandLog)
              .values({
                ...receiptMetadata,
                commandId: envelope.commandId,
                designId,
                sessionId: envelope.sessionId,
                commandType: envelope.command.type,
                commandJson: identity ? canonicalJson(envelope.command) : JSON.stringify(envelope.command),
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
          const isNetRebind = command.type === "pcb_rebind_net_references";
          const isPcbCommand = !isNetRebind && commandTouchesPcb(command);
          const rebindDelta: { current: RawNetRebindDelta | null } = { current: null };
          // Lazy legacy board-fill migration (contract §12.1) BEFORE the
          // before-snapshot: every settings writer re-serialises the parsed
          // record, which would drop the unread legacy keys unread.
          if (!isNetRebind) migrateLegacyBoardFill(
            tx,
            designId,
            netNamesFromSchematic(projection),
            timestamp,
            { mode: identityState.mode === "durable" ? "bound" : "name-hint" },
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
            pcbBefore_ &&
            placementsBefore &&
            tracesBefore &&
            viasBefore &&
            freeHolesBefore &&
            freePadsBefore &&
            zonesBefore &&
            keepoutsBefore
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
          let result = executeDesignerCommand({
            tx,
            designId,
            revision: head.revision,
            identityMode: identityState.mode,
            command,
            projection,
            timestamp,
            placeComponentDetail,
            ...(refreshComponentDetails ? { refreshComponentDetails } : {}),
            ...(pcbBefore ? { pcbBefore } : {}),
            ...(isNetRebind ? { onNetRebindApplied: (delta: RawNetRebindDelta) => { rebindDelta.current = delta; } } : {}),
          });

          result = syncDispatchedIdentity(tx, designId, command, result, identityState, head.revision, timestamp);
          const activeAfter = identityState.mode === "durable" ? readNetIdentityState(tx, designId)!.active : undefined;

          // Naming edits retain anonymous multipin protection; geometry edits
          // protect named nets. Thrown inside the transaction so
          // the executor's writes, revision bump and command-log row all roll
          // back (a refusal leaves no trace).
          const mergePolicy = getNetMergePolicy(command);
          if (result.ok && mergePolicy) {
            const after = loadSchematicProjection(tx, designId);
            const merge = after
              ? detectNetMerge(projection.nets, after.nets, mergePolicy)
              : null;
            if (merge) throw new NetMergeRefusal(merge.nets);
          }

          // View-only commands mutate display state in board_settings.viewState
          // but are not undoable — debounced slider drags would otherwise spam
          // the undo stack. Skip patch capture; the command still bumps the
          // revision so the projection refreshes.
          const isViewOnlyCommand = command.type === "pcb_set_view_state";

          if (result.ok && isNetRebind) {
            if (!rebindDelta.current) throw new Error("Successful net rebind did not return its raw delta");
            const patchSet = buildNetRebindHistoryPatchSet(rebindDelta.current);
            if (patchSet.forwardPatches.length > 0) pendingHistoryRef.current = {
              revision: result.revision, createdEntityId: result.createdEntityId, ...patchSet,
            };
          }
          if (result.ok && !isViewOnlyCommand && !isNetRebind) {
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
                    ...(activeBefore ? { activeNetIdentities: activeBefore } : {}),
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
                    ...(activeAfter ? { activeNetIdentities: activeAfter } : {}),
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
                  activeBefore && activeAfter ? { before: activeBefore, after: activeAfter } : undefined,
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
              ...receiptMetadata,
              commandId: envelope.commandId,
              designId,
              sessionId: envelope.sessionId,
              commandType: command.type,
              commandJson: identity ? canonicalJson(command) : JSON.stringify(command),
              resultJson: JSON.stringify(result),
              issuedAt: Math.trunc(envelope.issuedAt),
              appliedRevision: result.ok ? result.revision : head.revision,
              createdAt: timestamp,
            })
            .run();

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
            // Persist in the command transaction: the mutation and its undo entry commit together.
            persistSessionHistorySnapshot({
              db: tx, designId, sessionId: envelope.sessionId, history, timestamp,
            });
          }

          return result;
        });
        committed = true;
        // Test fault injection at the durable commit/publication boundary.
        hooks?.afterCommandCommit?.(envelope.commandId);

        const pendingHistory = pendingHistoryRef.current;

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
        if (!committed) history.restore(previousHistory);
        if (error instanceof NetMergeRefusal) {
          return {
            ok: false,
            code: "NET_MERGE_REQUIRES_CONFIRM",
            message: "This change would merge distinct nets",
            nets: error.nets,
          };
        }
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
          return replay(racedLog);
        }

        return conflict(envelope.baseRevision, -1);
      }
    },

    async getHistory(designId, sessionId) {
      ensureNetIdentity(db, designId, ctx.logger);
      const history = resolveSessionHistory(designId, sessionId);
      return summarizeHistory(history);
    },

    async undo(designId, sessionId, expectedRevision) {
      return replayHistory(designId, sessionId, "undo", expectedRevision);
    },

    async redo(designId, sessionId, expectedRevision) {
      return replayHistory(designId, sessionId, "redo", expectedRevision);
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
      }, ctx.logger);
    },

    async getCloudLink(designId) {
      return readLinkPublic(db, designId);
    },

    async unlinkDesignFromCloud(designId) {
      unlinkDesign(db, designId);
    },
  };
}
