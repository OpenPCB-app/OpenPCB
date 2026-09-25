/**
 * `batch_commands` (T-096): one user action over a selection — delete, rotate,
 * align, group move — as ONE command, so it is one revision and one undo entry
 * (the dispatcher diffs the state before and after the whole command) and all
 * or nothing.
 *
 * Handlers return error RESULTS rather than throwing, so a failure late in the
 * batch would otherwise commit the earlier steps with it. The steps therefore
 * run inside a SAVEPOINT: the first failing step aborts it and its result
 * becomes the batch's, with nothing persisted. The dispatcher's own
 * transaction then records that result in the command log as usual.
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerBatchableCommand,
  DesignerBatchCommandsCommand,
  DesignerCommand,
  DesignerDispatchResult,
  DesignerSchematicProjection,
} from "../../../../sdks";
import { DESIGNER_BATCH_MAX_COMMANDS } from "../../../../sdks/designer";
import type { PcbRowsBefore } from "../command-executor";
import {
  ensurePcbBoardSettings,
  loadPcbFreeHoles,
  loadPcbFreePads,
  loadPcbKeepouts,
  loadPcbPlacements,
  loadPcbTraces,
  loadPcbVias,
  loadPcbZones,
} from "../pcb/pcb-store";
import { loadSchematicProjection } from "../projection-read";
import { okResult } from "../results";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

const NOT_BATCHABLE: ReadonlySet<string> = new Set([
  "batch_commands",
  "place_part",
  "pcb_set_view_state",
  "pcb_apply_autolayout_candidate",
]);

/** The ONE list of what a batch may carry — the HTTP parser and the executor. */
export function isBatchableCommandType(type: string): boolean {
  return !NOT_BATCHABLE.has(type);
}

/**
 * Whether the command writes PCB rows, i.e. whether the dispatcher must
 * snapshot them for the undo patch and hand the gate its rows.
 */
export function commandTouchesPcb(command: DesignerCommand): boolean {
  if (command.type === "batch_commands") {
    return command.commands.some((step) => step.type.startsWith("pcb_"));
  }
  return command.type.startsWith("pcb_");
}

export type BatchStepExecutor = (step: {
  tx: DbClient;
  command: DesignerBatchableCommand;
  projection: DesignerSchematicProjection;
  pcbBefore?: PcbRowsBefore;
}) => DesignerDispatchResult;

class BatchAborted extends Error {
  constructor(readonly result: DesignerDispatchResult) {
    super("batch_commands aborted by a failing step");
  }
}

/** The rows the copper gate judges a pcb step against — as they are NOW. */
function loadPcbRows(
  tx: DbClient,
  designId: string,
  timestamp: string,
): PcbRowsBefore {
  return {
    board: ensurePcbBoardSettings(tx, designId, timestamp),
    placements: loadPcbPlacements(tx, designId),
    traces: loadPcbTraces(tx, designId),
    vias: loadPcbVias(tx, designId),
    freeHoles: loadPcbFreeHoles(tx, designId),
    freePads: loadPcbFreePads(tx, designId),
    zones: loadPcbZones(tx, designId).zones,
    keepouts: loadPcbKeepouts(tx, designId),
  };
}

function schematicEntityIds(
  projection: DesignerSchematicProjection,
): Set<string> {
  return new Set([
    ...projection.parts.map((part) => part.id),
    ...projection.wires.map((wire) => wire.id),
    ...projection.labels.map((label) => label.id),
    ...projection.primitives.map((primitive) => primitive.id),
  ]);
}

/**
 * Deleting a part or a port deletes its attached wires; a selection that also
 * named one of those wires must not fail on it. Only an entity that EXISTED
 * when the batch began qualifies — a genuinely unknown id still fails.
 */
function isAlreadyDeleted(
  step: DesignerBatchableCommand,
  result: DesignerDispatchResult,
  initialIds: ReadonlySet<string>,
): boolean {
  return (
    step.type === "delete_entity" &&
    !result.ok &&
    result.code === "ENTITY_NOT_FOUND" &&
    initialIds.has(step.entityId)
  );
}

function assertBatchable(command: DesignerBatchCommandsCommand): void {
  // The HTTP parser refuses all of these with a 400; reaching here means an
  // in-process caller bypassed it. Throwing aborts the dispatch transaction.
  if (command.commands.length > DESIGNER_BATCH_MAX_COMMANDS) {
    throw new Error(
      `batch_commands carries more than ${DESIGNER_BATCH_MAX_COMMANDS} commands`,
    );
  }
  const refused = command.commands.find(
    (step) => !isBatchableCommandType(step.type),
  );
  if (refused) {
    throw new Error(`batch_commands cannot carry '${refused.type}'`);
  }
}

export function executeBatchCommands(params: {
  tx: DbClient;
  designId: string;
  revision: number;
  timestamp: string;
  command: DesignerBatchCommandsCommand;
  projection: DesignerSchematicProjection;
  executeStep: BatchStepExecutor;
}): DesignerDispatchResult {
  const { designId, revision, timestamp, command } = params;
  assertBatchable(command);
  const initialIds = schematicEntityIds(params.projection);
  try {
    return params.tx.transaction((savepointRaw) => {
      const tx = savepointRaw as DbClient;
      let projection = params.projection;
      let stale = false;
      let applied = 0;
      let legality: { refused: number; warnings: number } | undefined;
      for (const step of command.commands) {
        // `delete_entity` never reads the projection, so a run of deletes (the
        // bulk case) does not re-derive every net once per step.
        if (stale && step.type !== "delete_entity") {
          projection = loadSchematicProjection(tx, designId) ?? projection;
          stale = false;
        }
        const result = params.executeStep({
          tx,
          command: step,
          projection,
          ...(step.type.startsWith("pcb_")
            ? { pcbBefore: loadPcbRows(tx, designId, timestamp) }
            : {}),
        });
        if (!result.ok) {
          if (isAlreadyDeleted(step, result, initialIds)) continue;
          throw new BatchAborted(result);
        }
        applied += 1;
        if (result.legality) {
          legality = {
            refused: (legality?.refused ?? 0) + result.legality.refused,
            warnings: (legality?.warnings ?? 0) + result.legality.warnings,
          };
        }
        stale = true;
      }
      // Every step bumped the head from the SAME base revision, so the batch
      // is exactly one revision — or none, when every step was a no-op.
      return okResult(applied > 0 ? revision + 1 : revision, null, legality);
    });
  } catch (error) {
    if (error instanceof BatchAborted) return error.result;
    throw error;
  }
}
