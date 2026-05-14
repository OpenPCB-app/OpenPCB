import { asc, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
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
  type DesignerCommandEnvelope,
  type DesignerDesignRecord,
  type DesignerDesignSummary,
  type DesignerDispatchResult,
  type DesignerHistoryActionResult,
  type DesignerHistorySnapshot,
  type DesignerPcbProjection,
  type DesignerSchematicProjection,
  type DesignerSearchLibraryParams,
  type LibraryComponent,
  type LibraryComponentPlacementDetail,
  type LibrarySDK,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { executeDesignerCommand } from "./command-executor";
import {
  commandLog,
  designHeads,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicWires,
  pcbEntities,
  sessionHistories as sessionHistoryRows,
} from "./schema";
import {
  ensurePcbBoardSettings,
  loadPcbPlacements,
  loadPcbTraces,
  loadPcbVias,
  replacePcbBoardSettings,
  replacePcbPlacements,
  replacePcbTraces,
  replacePcbVias,
} from "./pcb/pcb-store";
import { loadPcbProjection } from "./pcb/pcb-projection";
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
  loadSchematicProjection,
  mapDesignSummary,
  toDesignRecordFromProjection,
} from "./projection-read";
import { conflict, parseDispatchResultJson } from "./results";

type DbClient = BunSQLiteDatabase<Record<string, unknown>>;

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
  searchLibraryComponents(
    params: DesignerSearchLibraryParams,
  ): Promise<LibraryComponent[]>;
  resolveLibraryComponentForPlacement(
    componentId: string,
  ): Promise<LibraryComponentPlacementDetail | null>;
  dispatchCommand(
    designId: string,
    envelope: DesignerCommandEnvelope,
  ): Promise<DesignerDispatchResult>;
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
      const pcb = ensurePcbBoardSettings(tx, designId, timestamp);
      const placements = loadPcbPlacements(tx, designId);
      const traces = loadPcbTraces(tx, designId);
      const vias = loadPcbVias(tx, designId);
      const nextRevision = current.revision + 1;
      const world = combinedStateToWorld({
        schematic: current,
        pcb,
        placements,
        traces,
        vias,
      });
      applyPatches(world, patches);
      const next = combinedStateFromWorld(designId, nextRevision, world);
      replaceSchematicProjection(tx, designId, next.schematic, timestamp);
      replacePcbBoardSettings(tx, designId, next.pcb, timestamp);
      replacePcbPlacements(tx, designId, next.placements, timestamp);
      replacePcbTraces(tx, designId, next.traces, timestamp);
      replacePcbVias(tx, designId, next.vias, timestamp);
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
      return rows.map(mapDesignSummary);
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

      return toDesignRecordFromProjection(mapDesignSummary(head), projection);
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
      db.delete(schematicPins)
        .where(eq(schematicPins.designId, designId))
        .run();
      db.delete(schematicWires)
        .where(eq(schematicWires.designId, designId))
        .run();
      db.delete(schematicLabels)
        .where(eq(schematicLabels.designId, designId))
        .run();
      db.delete(schematicParts)
        .where(eq(schematicParts.designId, designId))
        .run();
      db.delete(commandLog).where(eq(commandLog.designId, designId)).run();
      db.delete(pcbEntities).where(eq(pcbEntities.designId, designId)).run();
      db.delete(sessionHistoryRows)
        .where(eq(sessionHistoryRows.designId, designId))
        .run();
      db.delete(designHeads).where(eq(designHeads.id, designId)).run();
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

    async dispatchCommand(designId, envelope) {
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
          const pcbBefore = isPcbCommand
            ? ensurePcbBoardSettings(tx, designId, timestamp)
            : null;
          const placementsBefore = isPcbCommand
            ? loadPcbPlacements(tx, designId)
            : null;
          const tracesBefore = isPcbCommand
            ? loadPcbTraces(tx, designId)
            : null;
          const viasBefore = isPcbCommand ? loadPcbVias(tx, designId) : null;
          const result = executeDesignerCommand({
            tx,
            designId,
            revision: head.revision,
            command,
            projection,
            timestamp,
            placeComponentDetail,
          });

          if (result.ok) {
            const nextProjection = loadSchematicProjection(tx, designId);
            if (nextProjection) {
              if (pcbBefore) {
                const pcbAfter = ensurePcbBoardSettings(
                  tx,
                  designId,
                  timestamp,
                );
                const placementsAfter = loadPcbPlacements(tx, designId);
                const tracesAfter = loadPcbTraces(tx, designId);
                const viasAfter = loadPcbVias(tx, designId);
                const patchSet = buildCombinedHistoryPatchSet(
                  {
                    schematic: projection,
                    pcb: pcbBefore,
                    placements: placementsBefore ?? [],
                    traces: tracesBefore ?? [],
                    vias: viasBefore ?? [],
                  },
                  {
                    schematic: nextProjection,
                    pcb: pcbAfter,
                    placements: placementsAfter,
                    traces: tracesAfter,
                    vias: viasAfter,
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

        return result;
      } catch {
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
      return {
        ok: true,
        revision,
        history: summarizeHistory(history),
      };
    },
  };
}
