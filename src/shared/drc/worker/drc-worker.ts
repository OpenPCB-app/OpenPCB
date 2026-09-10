/**
 * The DRC worker entry (execution contract 09 §2).
 *
 * One persistent `node:worker_threads` worker per backend process runs the
 * UNCHANGED engine on a structured clone of the projection, so its report is
 * the same bytes `runDrc` produces in-thread (§6). It imports only from
 * `src/shared/**` (plus `src/sdks/designer` types) and `node:worker_threads`:
 * no `src/core`, no `src/modules`, no database, no environment. It never
 * calls `process.exit` — the client owns the thread's lifetime.
 */
import { parentPort } from "node:worker_threads";
import type { RawFootprintLookup } from "../../pcb-geometry/courtyard";
import { runDrc } from "../drc-engine";
import { DrcCancelledError, type DrcStage, type DrcTick } from "../types";
import {
  PROGRESS_MIN_MS,
  type DrcWorkerRequest,
  type DrcWorkerResponse,
} from "./protocol";

if (!parentPort) {
  throw new Error("drc-worker: loaded outside a worker thread (no parentPort)");
}
const port = parentPort;

function post(message: DrcWorkerResponse): void {
  port.postMessage(message);
}

function runOne(request: DrcWorkerRequest): void {
  const { runId, projection, rawFootprints, cancel } = request;

  // Rebuild the EXACT value `buildRawFootprintLookup` returned on the main
  // thread: `undefined` when it had nothing to offer, a Map-backed closure
  // otherwise (§2.2).
  const byId =
    rawFootprints === null
      ? null
      : new Map<string, Record<string, unknown>>(rawFootprints);
  const lookupRawFootprint: RawFootprintLookup | undefined =
    byId === null ? undefined : (footprintId) => byId.get(footprintId) ?? null;

  const flag = new Int32Array(cancel);
  let lastStage: DrcStage | null = null;
  let lastPostMs = Number.NEGATIVE_INFINITY;
  // The pour ticks carry no draft count (they fire inside a stage), so the
  // last stage count stands in — which keeps the series non-decreasing.
  let violations = 0;

  const tick: DrcTick = (stage, index, total, violationsSoFar) => {
    // Cancellation is read here and nowhere else: the engine's checkpoints are
    // the only places a run may be abandoned (§3).
    if (Atomics.load(flag, 0) === 1) throw new DrcCancelledError();
    if (violationsSoFar !== undefined) violations = violationsSoFar;

    const now = performance.now();
    const boundary = stage !== lastStage || index === total - 1;
    if (!boundary && now - lastPostMs < PROGRESS_MIN_MS) return;
    lastStage = stage;
    lastPostMs = now;
    post({
      type: "progress",
      runId,
      stage,
      index,
      total,
      violationsSoFar: violations,
    });
  };

  try {
    const report = runDrc(projection, { lookupRawFootprint, tick });
    post({ type: "done", runId, report });
  } catch (error) {
    if (error instanceof DrcCancelledError) {
      post({ type: "cancelled", runId });
      return;
    }
    post({
      type: "error",
      runId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

port.on("message", (request: DrcWorkerRequest) => {
  if (request.type !== "run") return;
  runOne(request);
});

// Last, so the client only unblocks once the engine graph is imported.
post({ type: "ready" });
