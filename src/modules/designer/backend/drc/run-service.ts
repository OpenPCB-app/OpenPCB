/**
 * `DrcRunService` — the ONE owner of every batch DRC run (execution contract
 * 09 §1, §3, §5).
 *
 * Every batch caller goes through here: `POST /designs/:id/drc/run` and
 * `/drc/runs`, the designer SDK's `runDrc` (assistant tool, MCP resource,
 * proposal apply) and the three cloud apply sites. Nothing in module code
 * calls `runDrc` inline any more, which is what makes these invariants hold
 * for all of them at once:
 *
 *   * The engine executes on the worker (`src/shared/drc/worker/`), never on
 *     the request path, so command dispatch and the SSE stream keep running
 *     while a dense board is checked.
 *   * Per design at most ONE non-terminal run. A `start` with the same
 *     `(revision, optionsDigest)` joins it; a different key supersedes it and
 *     the superseded caller is re-attached to the newer run (§5).
 *   * Persistence is a single synchronous upsert on the main thread AFTER the
 *     worker's `done`, guarded by "not cancelled" and "the design head still
 *     exists" — with no `await` between the checks and the write, so nothing
 *     partial and nothing orphaned can be stored (§3).
 *   * Every promise the service creates settles inside the service. A DRC
 *     failure must never surface as an unhandled rejection in Electron's main
 *     process.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerPcbProjection,
  DrcReport,
  DrcRunCancelReason,
  DrcRunProgress,
  DrcRunSnapshot,
  DrcRunStatus,
} from "../../../../sdks/designer";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { NotFoundError } from "../../../../core/contracts/errors";
import {
  runDrcOnWorker,
  type DrcWorkerProgress,
} from "../../../../shared/drc/worker/drc-worker-client";
import { DrcCancelledError } from "../../../../shared/drc/types";
import { saveDrcResult, type SaveDrcOptions } from "../drc-results";
import { buildRawFootprintEntries } from "../pcb/raw-footprint-lookup";
import { designHeads } from "../schema";
import type { DesignerStore } from "../store";
import { DRC_STAGES, drcOptionsFromProjection } from "./drc-engine";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

/** How long a terminal run stays readable through `GET /runs/:runId` (§1). */
export const RUN_RETENTION_MS = 600_000;

/**
 * A waiter's run ended without a report. `reason` says why: `user` is an
 * explicit cancel, `design-deleted` a design removed mid-run, `shutdown` a
 * disposed service. A `superseded` run never rejects — its waiters are
 * re-attached to the run that superseded it (§1).
 */
export class DrcRunCancelledError extends Error {
  readonly reason: DrcRunCancelReason;

  constructor(reason: DrcRunCancelReason) {
    super(`DRC run cancelled (${reason})`);
    this.name = "DrcRunCancelledError";
    this.reason = reason;
  }
}

export type DrcRunListener = (snapshot: DrcRunSnapshot) => void;

export interface DrcRunService {
  /** Start a run, join the design's active run, or supersede it (§5). */
  start(designId: string): Promise<DrcRunSnapshot>;
  /** Start (or join) and resolve with the report the run produced. */
  runAndWait(designId: string): Promise<DrcReport>;
  get(runId: string): DrcRunSnapshot | null;
  cancel(runId: string, reason?: DrcRunCancelReason): DrcRunSnapshot | null;
  subscribe(runId: string, listener: DrcRunListener): () => void;
  /** Test seam: proves a disconnected SSE stream really unsubscribed. */
  listenerCount(runId: string): number;
  dispose(): void;
}

interface RunRecord {
  runId: string;
  designId: string;
  revision: number;
  optionsDigest: string;
  status: DrcRunStatus;
  progress: DrcRunProgress;
  startedAt: string;
  finishedAt?: string;
  summary?: DrcReport["summary"];
  error?: string;
  cancelReason?: DrcRunCancelReason;
  /** The snapshot the run computes over; cloned into the worker (§2.2). */
  projection: DesignerPcbProjection;
  /** Recorded with the stored row, exactly as the pre-S10 route did. */
  options: SaveDrcOptions;
  /** Cooperative cancel for the worker; also drops a queued run. */
  controller: AbortController;
  settled: Promise<DrcReport>;
  resolve: (report: DrcReport) => void;
  reject: (error: Error) => void;
  listeners: Set<DrcRunListener>;
  /** The last non-pour stage index, so pour frames land inside their stage. */
  stageIndex: number;
  retention: ReturnType<typeof setTimeout> | null;
}

const TERMINAL: ReadonlySet<DrcRunStatus> = new Set<DrcRunStatus>([
  "completed",
  "cancelled",
  "failed",
]);

function isTerminal(status: DrcRunStatus): boolean {
  return TERMINAL.has(status);
}

function snapshotOf(run: RunRecord): DrcRunSnapshot {
  return {
    runId: run.runId,
    designId: run.designId,
    revision: run.revision,
    status: run.status,
    progress: { ...run.progress },
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.summary ? { summary: { ...run.summary } } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.cancelReason ? { cancelReason: run.cancelReason } : {}),
  };
}

/**
 * The join key's second half (§5). View-state suppressions bump the revision,
 * so the digest is insurance rather than the mechanism — but a rules-only
 * change that somehow kept the revision must still supersede.
 */
function computeOptionsDigest(projection: DesignerPcbProjection): string {
  const payload = JSON.stringify({
    ...drcOptionsFromProjection(projection),
    severityOverrides: projection.board.drcSeverityOverrides ?? null,
  });
  return createHash("sha1").update(payload).digest("hex");
}

function queuedProgress(): DrcRunProgress {
  return {
    stage: "queued",
    index: 0,
    total: DRC_STAGES.length,
    fraction: 0,
    violationsSoFar: 0,
  };
}

export function createDrcRunService(params: {
  store: DesignerStore;
  ctx: CoreBackendModuleContext;
}): DrcRunService {
  const { store, ctx } = params;
  const logger = ctx.logger;
  // Same module-db unwrap the store uses: the completion path needs a raw
  // drizzle handle so the head check and the upsert share ONE tick (§3).
  const db = (ctx.db as unknown as { db: DbClient }).db;

  const runs = new Map<string, RunRecord>();
  /** Non-terminal run per design — the join / supersede lookup (§5). */
  const activeByDesign = new Map<string, string>();
  /** FIFO across designs; the queue holds run ids, not records. */
  const queue: string[] = [];
  let executing: string | null = null;
  let disposed = false;

  function notify(run: RunRecord): void {
    if (run.listeners.size === 0) return;
    const snapshot = snapshotOf(run);
    for (const listener of [...run.listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        // A subscriber (an SSE controller whose client vanished) must never
        // take the run down with it.
        logger.warn?.("drc run: listener failed", {
          runId: run.runId,
          error: String(error),
        });
      }
    }
  }

  function scheduleRetention(run: RunRecord): void {
    if (run.retention !== null) return;
    const timer = setTimeout(() => {
      runs.delete(run.runId);
    }, RUN_RETENTION_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    run.retention = timer;
  }

  /** The single terminal transition: state, waiters, subscribers, retention. */
  function finish(
    run: RunRecord,
    outcome:
      | {
          status: "completed";
          summary: DrcReport["summary"];
          report: DrcReport;
        }
      | { status: "failed"; message: string }
      | {
          status: "cancelled";
          reason: DrcRunCancelReason;
          successor?: RunRecord;
        },
  ): void {
    if (isTerminal(run.status)) return;
    run.status = outcome.status;
    run.finishedAt = new Date().toISOString();
    if (activeByDesign.get(run.designId) === run.runId) {
      activeByDesign.delete(run.designId);
    }
    const queued = queue.indexOf(run.runId);
    if (queued >= 0) queue.splice(queued, 1);

    if (outcome.status === "completed") {
      run.summary = outcome.summary;
      run.progress = {
        ...run.progress,
        index: DRC_STAGES.length,
        total: DRC_STAGES.length,
        fraction: 1,
        violationsSoFar: outcome.report.violations.length,
      };
      run.resolve(outcome.report);
    } else if (outcome.status === "failed") {
      run.error = outcome.message;
      run.reject(new Error(outcome.message));
    } else {
      run.cancelReason = outcome.reason;
      if (outcome.successor) {
        // A superseded caller waits for the run that replaced it (§1).
        outcome.successor.settled.then(run.resolve, run.reject);
      } else {
        run.reject(new DrcRunCancelledError(outcome.reason));
      }
    }

    notify(run);
    scheduleRetention(run);
  }

  /** Marks terminal AND stops the engine; the worker's result is dropped. */
  function cancelRun(
    run: RunRecord,
    reason: DrcRunCancelReason,
    successor?: RunRecord,
  ): void {
    if (isTerminal(run.status)) return;
    finish(run, {
      status: "cancelled",
      reason,
      ...(successor ? { successor } : {}),
    });
    // After the transition: the abort rejects the worker promise, and the
    // executor sees a run that is already terminal and drops the outcome.
    run.controller.abort();
  }

  function onProgress(run: RunRecord, progress: DrcWorkerProgress): void {
    if (run.status !== "running") return;
    const stages = DRC_STAGES.length;
    let fraction: number;
    if (progress.stage === "pour") {
      // A pour frame reports zones, not stages: keep the run inside the stage
      // that asked for the fill and advance by the zone fraction (§4).
      const zoneFraction =
        progress.total > 0 ? progress.index / progress.total : 0;
      fraction = (run.stageIndex + zoneFraction) / stages;
    } else {
      run.stageIndex = progress.index;
      fraction = progress.total > 0 ? progress.index / progress.total : 0;
    }
    run.progress = {
      stage: progress.stage,
      index: progress.index,
      total: progress.total,
      fraction: Math.min(1, Math.max(0, fraction)),
      violationsSoFar: progress.violationsSoFar,
    };
    notify(run);
  }

  /**
   * The completion path. Every step from the cancellation check to the upsert
   * is synchronous — no `await` may be introduced here (§3) — and the row is
   * written BEFORE the run turns `completed`, because the frontend `GET`s
   * `/drc` the moment it sees that event (§7).
   */
  function persistAndComplete(run: RunRecord, report: DrcReport): void {
    if (run.status !== "running") return;
    const head = db
      .select()
      .from(designHeads)
      .where(eq(designHeads.id, run.designId))
      .get();
    if (!head) {
      // The design was deleted while the run executed: writing would breach
      // the FK on `designer_design_heads` (§3).
      cancelRun(run, "design-deleted");
      return;
    }
    try {
      saveDrcResult(
        db,
        run.designId,
        report,
        run.options,
        new Date().toISOString(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error?.("drc run: persisting the report failed", {
        runId: run.runId,
        designId: run.designId,
        error: message,
      });
      finish(run, { status: "failed", message });
      return;
    }
    finish(run, {
      status: "completed",
      summary: report.summary,
      report,
    });
  }

  async function execute(run: RunRecord): Promise<void> {
    try {
      const rawFootprints = await buildRawFootprintEntries(ctx, run.projection);
      // Cancelled or superseded while the library reads were in flight.
      if (run.status !== "running") return;
      const report = await runDrcOnWorker(
        { projection: run.projection, rawFootprints },
        {
          signal: run.controller.signal,
          onProgress: (progress) => onProgress(run, progress),
        },
      );
      persistAndComplete(run, report);
    } catch (error) {
      // A cancelled run is already terminal — the worker's rejection is the
      // echo of our own abort and carries no new information.
      if (run.status !== "running") return;
      if (error instanceof DrcCancelledError) {
        // A cancel this service did not ask for: `disposeDrcWorker()` on a
        // signal, or the hard terminate behind a runaway kernel (§3).
        cancelRun(run, "shutdown");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error?.("drc run failed", {
        runId: run.runId,
        designId: run.designId,
        error: message,
      });
      finish(run, { status: "failed", message });
    } finally {
      if (executing === run.runId) {
        executing = null;
        pump();
      }
    }
  }

  /** One run at a time, FIFO across designs (§5). */
  function pump(): void {
    if (disposed || executing !== null) return;
    while (queue.length > 0) {
      const runId = queue.shift()!;
      const run = runs.get(runId);
      if (!run || run.status !== "queued") continue;
      run.status = "running";
      executing = run.runId;
      notify(run);
      void execute(run);
      return;
    }
  }

  function createRun(
    designId: string,
    projection: DesignerPcbProjection,
    optionsDigest: string,
  ): RunRecord {
    let resolve: (report: DrcReport) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const settled = new Promise<DrcReport>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // A run nobody awaits (the frontend never calls `runAndWait`) must not
    // become an unhandled rejection when it is cancelled.
    void settled.catch(() => {});
    const run: RunRecord = {
      runId: crypto.randomUUID(),
      designId,
      revision: projection.revision,
      optionsDigest,
      status: "queued",
      progress: queuedProgress(),
      startedAt: new Date().toISOString(),
      projection,
      options: drcOptionsFromProjection(projection),
      controller: new AbortController(),
      settled,
      resolve,
      reject,
      listeners: new Set(),
      stageIndex: 0,
      retention: null,
    };
    runs.set(run.runId, run);
    activeByDesign.set(designId, run.runId);
    queue.push(run.runId);
    return run;
  }

  async function startRun(designId: string): Promise<RunRecord> {
    if (disposed) throw new DrcRunCancelledError("shutdown");
    const projection = await store.getPcbProjection(designId);
    // `dispose()` may have landed during that await; a run created now would
    // sit `queued` forever because `pump()` no-ops once disposed (R2 #4).
    if (disposed) throw new DrcRunCancelledError("shutdown");
    if (!projection) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    // Nothing below this line awaits: the lookup and the insert are one tick,
    // so two concurrent `start`s cannot both create a run for one design.
    const optionsDigest = computeOptionsDigest(projection);
    const activeId = activeByDesign.get(designId);
    const active = activeId ? runs.get(activeId) : undefined;
    if (active && !isTerminal(active.status)) {
      if (
        active.revision === projection.revision &&
        active.optionsDigest === optionsDigest
      ) {
        return active;
      }
      // The successor exists before the cancel so the superseded run's
      // waiters have something to be re-attached to; only then does the
      // executor get a chance to pick anything up.
      const successor = createRun(designId, projection, optionsDigest);
      cancelRun(active, "superseded", successor);
      pump();
      return successor;
    }
    const created = createRun(designId, projection, optionsDigest);
    pump();
    return created;
  }

  return {
    async start(designId) {
      return snapshotOf(await startRun(designId));
    },

    async runAndWait(designId) {
      const run = await startRun(designId);
      return run.settled;
    },

    get(runId) {
      const run = runs.get(runId);
      return run ? snapshotOf(run) : null;
    },

    cancel(runId, reason = "user") {
      const run = runs.get(runId);
      if (!run) return null;
      if (isTerminal(run.status)) return snapshotOf(run);
      cancelRun(run, reason);
      return snapshotOf(run);
    },

    subscribe(runId, listener) {
      const run = runs.get(runId);
      if (!run) return () => {};
      run.listeners.add(listener);
      return () => {
        run.listeners.delete(listener);
      };
    },

    listenerCount(runId) {
      return runs.get(runId)?.listeners.size ?? 0;
    },

    dispose() {
      disposed = true;
      queue.length = 0;
      for (const run of [...runs.values()]) {
        if (!isTerminal(run.status)) cancelRun(run, "shutdown");
        if (run.retention !== null) {
          clearTimeout(run.retention);
          run.retention = null;
        }
        run.listeners.clear();
      }
      runs.clear();
      activeByDesign.clear();
      executing = null;
    },
  };
}

/**
 * ONE service per module context. The designer builds its SDK and its routes
 * from two separate stores over the same `ctx.db` (see `capture/index.ts` for
 * the same problem) — but there is only one worker, so both must reach the
 * same run registry or a `start` from the SDK could not be joined by the
 * route. Keyed on `ctx.db`, whose identity is per module bootstrap, so a test
 * that boots a second runtime gets a second service instead of one holding a
 * closed database.
 */
const services = new WeakMap<object, DrcRunService>();

export function resolveDrcRunService(
  ctx: CoreBackendModuleContext,
  store: DesignerStore,
): DrcRunService {
  const key = ctx.db as unknown as object;
  const existing = services.get(key);
  if (existing) return existing;
  const created = createDrcRunService({ store, ctx });
  services.set(key, created);
  return created;
}

