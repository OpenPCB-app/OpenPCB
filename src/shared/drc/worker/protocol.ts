/**
 * The wire format between the DRC worker and its main-thread owner
 * (execution contract 09 §2). Types only plus two timing constants, so both
 * sides import this file and neither can drift from the other.
 *
 * Everything that crosses is structured-cloneable: the projection and the
 * report are plain JSON-shaped data, and `cancel` is a `SharedArrayBuffer`
 * (shared, never transferred) carrying the single cooperative cancel flag
 * (§3).
 */
import type { DesignerPcbProjection, DrcReport } from "../../../sdks/designer";
import type { DrcStage } from "../types";

/**
 * Progress floor: at most one `progress` message per this many milliseconds
 * WITHIN one stage. A stage change and the last tick of a stage always post,
 * so a fast board still reports every stage (§2).
 */
export const PROGRESS_MIN_MS = 50;

/**
 * How long the client waits for `cancelled` (or a late `done`) after setting
 * the cancel flag before it terminates the thread (§3). One pour zone is
 * indivisible, so a runaway kernel can only be stopped this way.
 */
export const CANCEL_GRACE_MS = 250;

/** Start a run. The only message the client sends. */
export interface DrcWorkerRunRequest {
  type: "run";
  runId: string;
  projection: DesignerPcbProjection;
  /**
   * The entries of the map behind `buildRawFootprintLookup`'s closure, or
   * `null` when that helper returned `undefined`. The worker reproduces the
   * exact value rather than rely on "no lookup" and "lookup returning null"
   * being equivalent (§2.2).
   */
  rawFootprints: Array<[string, Record<string, unknown>]> | null;
  cancel: SharedArrayBuffer;
}

export type DrcWorkerRequest = DrcWorkerRunRequest;

/** Posted once, after the worker's own imports finish. */
export interface DrcWorkerReadyMessage {
  type: "ready";
}

/** Counts only — no partial violation list ever crosses (§4). */
export interface DrcWorkerProgressMessage {
  type: "progress";
  runId: string;
  /** `DrcStage` already includes the per-zone `"pour"` stage. */
  stage: DrcStage;
  index: number;
  total: number;
  violationsSoFar: number;
}

export interface DrcWorkerDoneMessage {
  type: "done";
  runId: string;
  report: DrcReport;
}

export interface DrcWorkerCancelledMessage {
  type: "cancelled";
  runId: string;
}

export interface DrcWorkerErrorMessage {
  type: "error";
  runId: string;
  message: string;
  stack?: string;
}

export type DrcWorkerResponse =
  | DrcWorkerReadyMessage
  | DrcWorkerProgressMessage
  | DrcWorkerDoneMessage
  | DrcWorkerCancelledMessage
  | DrcWorkerErrorMessage;
