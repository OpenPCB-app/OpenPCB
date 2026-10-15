// Apply ONE cloud Auto Layout candidate to the board, atomically.
//
// Order matters here, and each step exists for a reason:
//
//   1. idempotency — replay a previous result for the same applyRequestId BEFORE anything
//      else, straight from the command log: no cloud fetch, no digest check, no dispatch,
//      no DRC. If the first response was lost in transit, the retry must return the
//      original success, not "stale" (the board has legitimately moved on since — by this
//      very apply). The same id for a different request is AUTO_LAYOUT_REQUEST_CONFLICT.
//   2. re-fetch — pull the candidate from the service by (jobId, candidateId). The renderer
//      sends neither geometry nor operations, so a stale or tampered client cannot feed the
//      command layer copper the cloud never produced.
//   3. applicability — a failed candidate, or one whose routing stage never ran, is a
//      normal part of a result set. It is displayed, it is not applied.
//   4. staleness — compare the content digest, NOT the revision (view-state commands bump
//      the revision; see backend/pcb/board-content-digest.ts).
//   5. dispatch — one command envelope, one revision, one undo entry.
//   6. DRC — reported, never gating, matching every other apply path in this module.
//   7. selection feedback — fire-and-forget, only after a successful commit.

import type {
  DesignerCommandEnvelope,
  DesignerPcbApplyAutolayoutCandidateCommand,
  DesignerPcbCandidatePlacementOperation,
  DesignerPcbCandidateRouteOperation,
  DrcReport,
} from "../../../../sdks/designer";
import type { LayoutCandidate } from "../../../../sdks/designer/cloud-autolayout";
import { computeBoardContentDigest } from "../pcb/board-content-digest";
import { inspectLoggedResult, parseDispatchResultJson } from "../results";
import type { LoggedUiCommand } from "../store";
import { asRecord } from "../value-guards";
import { AutoLayoutError } from "./errors";
import { getLayoutResult, selectLayoutCandidate } from "./layout-client";
import {
  assertApplicable,
  requireCandidate,
  type ApplyCandidateRequest,
} from "./parsers";

export interface ApplyCandidateResult {
  applied: true;
  revision: number;
  jobId: string;
  candidateId: string;
  placementOperationCount: number;
  routeOperationCount: number;
  drc: DrcReport | null;
  warnings: string[];
  /** Set when this is the logged result of an earlier attempt (its response was lost). */
  replayed?: true;
}

/** The command-log row already written under an applyRequestId. */
export type PriorApply = LoggedUiCommand;

export interface ApplyCandidateDeps {
  designId: string;
  bearer: string;
  request: ApplyCandidateRequest;
  /** Current PCB projection + revision, or null when the design has no PCB. */
  loadProjection: () => Promise<import("../../../../sdks/designer").DesignerPcbProjection | null>;
  dispatch: (
    envelope: DesignerCommandEnvelope,
  ) => Promise<import("../../../../sdks/designer").DesignerDispatchResult>;
  /** Step 1: the row logged under `applyRequestId`, or null when it was never applied. */
  findPriorApply: (applyRequestId: string) => PriorApply | null;
  /**
   * Post-apply report, by design id: the run service loads the projection it
   * runs over itself, so the report always describes the committed revision.
   * `null` when there is nothing to report (no PCB, or the run was cancelled).
   */
  runDrc: (designId: string) => Promise<DrcReport | null>;
}

function toCommandProvenance(
  result: import("../../../../sdks/designer/cloud-autolayout").LayoutResultEnvelope,
): DesignerPcbApplyAutolayoutCandidateCommand["provenance"] {
  // Bounded on purpose: enough to trace an applied candidate back to the engine build that
  // produced it, never the whole result (which is megabytes and would ride the command log
  // into every history replay).
  return {
    ...(result.engineVersions ? { engineVersions: result.engineVersions } : {}),
    ...(result.objectiveVersion ? { objectiveVersion: result.objectiveVersion } : {}),
    ...(result.snapshotHash ? { cloudSnapshotHash: result.snapshotHash } : {}),
  };
}

function candidateWarnings(candidate: LayoutCandidate): string[] {
  return [...(candidate.warnings ?? [])];
}

/** Today's mapping of a non-ok dispatch, shared by the live and the replayed path. */
function dispatchFailure(code: string | null, detail: unknown): AutoLayoutError {
  if (code === "REVISION_CONFLICT") {
    return new AutoLayoutError(
      "AUTO_LAYOUT_REVISION_CONFLICT",
      "The board was edited while the candidate was being applied. Run Auto Layout again.",
      { detail },
    );
  }
  return new AutoLayoutError(
    "AUTO_LAYOUT_OPERATION_INVALID",
    "OpenPCB rejected an operation in this candidate; nothing was applied.",
    { detail },
  );
}

function operationCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Step 1. The logged row answers the retry on its own: the id was minted for
 * exactly one (design, session, job, candidate, digest), and anything else
 * under it is a client bug, not a second apply.
 */
function replayPriorApply(
  designId: string,
  request: ApplyCandidateRequest,
  prior: PriorApply,
): ApplyCandidateResult {
  const command = asRecord(prior.command);
  const sameRequest =
    !prior.operationIdentity &&
    prior.designId === designId &&
    prior.sessionId === request.sessionId &&
    prior.commandType === "pcb_apply_autolayout_candidate" &&
    command?.jobId === request.jobId &&
    command?.candidateId === request.candidateId &&
    command?.snapshotDigest === request.snapshotDigest;
  if (!sameRequest) {
    throw new AutoLayoutError(
      "AUTO_LAYOUT_REQUEST_CONFLICT",
      "This apply request id was already used for a different request; nothing was applied.",
      { detail: { applyRequestId: request.applyRequestId } },
    );
  }
  const logged = parseDispatchResultJson(prior.resultJson);
  const raw = logged ? null : inspectLoggedResult(prior.resultJson);
  const ok = logged ? logged.ok : raw?.rawOk === true;
  if (!ok) {
    throw dispatchFailure(
      logged && !logged.ok ? logged.code : (raw?.rawCode ?? null),
      logged ?? { rawCode: raw?.rawCode ?? null },
    );
  }
  return {
    applied: true,
    revision: prior.appliedRevision,
    jobId: request.jobId,
    candidateId: request.candidateId,
    placementOperationCount: operationCount(command?.placementOperations),
    routeOperationCount: operationCount(command?.routeOperations),
    drc: null,
    warnings: [],
    replayed: true,
  };
}

export async function applyCandidate(
  deps: ApplyCandidateDeps,
): Promise<ApplyCandidateResult> {
  const { designId, bearer, request } = deps;

  const prior = deps.findPriorApply(request.applyRequestId);
  if (prior) return replayPriorApply(designId, request, prior);

  const result = await getLayoutResult(request.jobId, bearer);
  const candidate = requireCandidate(result, request.candidateId);
  const { placementOperations, routeOperations } = assertApplicable(candidate);

  const projection = await deps.loadProjection();
  if (!projection) {
    throw new AutoLayoutError(
      "AUTO_LAYOUT_STALE",
      "This design no longer has a PCB to apply the layout to.",
    );
  }

  const currentDigest = computeBoardContentDigest(projection);
  if (currentDigest !== request.snapshotDigest) {
    throw new AutoLayoutError(
      "AUTO_LAYOUT_STALE",
      "This board changed after Auto Layout started. Run Auto Layout again to generate candidates for the current board.",
      { detail: { expected: request.snapshotDigest, actual: currentDigest } },
    );
  }

  const command: DesignerPcbApplyAutolayoutCandidateCommand = {
    type: "pcb_apply_autolayout_candidate",
    jobId: request.jobId,
    candidateId: request.candidateId,
    snapshotDigest: request.snapshotDigest,
    placementOperations: placementOperations.map(
      (op) => op.payload as DesignerPcbCandidatePlacementOperation,
    ),
    routeOperations: routeOperations.map(
      (op) => op.payload as DesignerPcbCandidateRouteOperation,
    ),
    provenance: toCommandProvenance(result),
  };

  const dispatched = await deps.dispatch({
    // The client-generated applyRequestId IS the command id, so the existing command-log
    // idempotency check turns a transport retry into a replay of the original result
    // rather than a second application.
    commandId: request.applyRequestId,
    sessionId: request.sessionId,
    aggregateId: designId,
    baseRevision: projection.revision,
    issuedAt: Date.now(),
    command,
  });

  if (!dispatched.ok) {
    throw dispatchFailure(dispatched.code, dispatched);
  }

  const applied = await deps.loadProjection();
  const drc = applied ? await deps.runDrc(designId) : null;

  // Fire-and-forget: this is a supervision label, and a telemetry failure must never
  // invalidate a committed board change. Only ever sent after a successful apply — never
  // on preview or card selection, which would poison the label with idle browsing.
  void selectLayoutCandidate(request.jobId, request.candidateId, bearer).catch(() => {});

  return {
    applied: true,
    revision: dispatched.revision,
    jobId: request.jobId,
    candidateId: request.candidateId,
    placementOperationCount: placementOperations.length,
    routeOperationCount: routeOperations.length,
    drc,
    warnings: candidateWarnings(candidate),
  };
}
