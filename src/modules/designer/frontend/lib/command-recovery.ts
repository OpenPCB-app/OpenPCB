// Recovered-edit classification (OPENPCB-103 §3.8). Pure: a journaled intent
// plus read-only server evidence decides what the user may do with it. Nothing
// is resent here; "retry-same-id" is offered only where the server proves
// at-most-once (command-log PK replay, history `expectedRevision`, BOM binding
// guard), and only a lookup-proven commit is cleared without review.

import type {
  DesignerCommandLookup,
  DesignerDispatchResult,
  DesignerRecoveryHead,
} from "../../../../sdks";
import type { RetainedState } from "../../../../shared/frontend/commands/revision-command-queue";
import { dispatchFailureMessage } from "../pcb/dispatch-failure";
import {
  DESIGNER_RECOVERY_EPOCH,
  type DesignerRecoveryRecordV1,
  type RecoveryCompat,
} from "./designer-recovery-record";

export type RecoveryEvidence =
  | { kind: "lookup"; lookup: DesignerCommandLookup }
  | { kind: "head"; head: DesignerRecoveryHead }
  /** A 404 with the typed design-not-found problem only. */
  | { kind: "orphaned" }
  /** Transport / timeout / 5xx / any other 404 or 405. */
  | { kind: "unavailable"; message: string };

export type RecoveryLabel =
  | "incompatible"
  | "orphaned"
  | "unavailable"
  | "not-sent"
  | "conflicted"
  | "rejected"
  | "not-recorded"
  | "mismatch"
  | "head-moved"
  | "binding-changed"
  | "unverifiable";
export type RecoveryActionName =
  "apply-reviewed" | "retry-same-id" | "check-status" | "export" | "discard";

export type RecoveryClassification =
  | {
      autoClear: true;
      label: "saved";
      message: string;
      commandType: string;
      revision: number;
      /** null when this build cannot rebuild the logged result. */
      result: DesignerDispatchResult | null;
    }
  | {
      autoClear: false;
      label: RecoveryLabel;
      state: RetainedState;
      message: string;
      actions: readonly RecoveryActionName[];
    };
type Retained = Extract<RecoveryClassification, { autoClear: false }>;

/** Same build, same server schema and command semantics; a null on either side is never compatible. */
export function isRecoveryCompatible(
  stamp: RecoveryCompat,
  current: RecoveryCompat,
): boolean {
  return compatVerdict(stamp, current) === "compatible";
}

/**
 * `current === null`: the server's compat stamp could not be read now, so a
 * record that is not already incompatible by its own stamp is "unavailable"
 * (check again later) rather than permanently incompatible.
 */
export function classifyRecovered(
  record: DesignerRecoveryRecordV1,
  evidence: RecoveryEvidence,
  current: RecoveryCompat | null,
): RecoveryClassification {
  const compat = compatVerdict(record.compat, current);
  if (compat === "incompatible")
    return retained("failed", "incompatible", INCOMPATIBLE, REVIEW_ONLY);
  if (compat === "unknown")
    return unavailable("server compatibility could not be read");
  if (evidence.kind === "orphaned")
    return retained("failed", "orphaned", ORPHANED, REVIEW_ONLY);
  if (evidence.kind === "unavailable") return unavailable(evidence.message);
  if (record.phase === "queued") return notSent(record);
  const action = record.action;
  if (action.kind === "command")
    return evidence.kind === "lookup"
      ? fromLookup(action.command.type, evidence.lookup)
      : unavailable(EVIDENCE_MISMATCH);
  if (evidence.kind !== "head") return unavailable(EVIDENCE_MISMATCH);
  if (action.kind === "bom_override")
    return fromBomHead(action, evidence.head);
  return action.expectedRevision === evidence.head.headRevision
    ? retained("unknown", "not-recorded", HISTORY_NOT_APPLIED(action.kind), RETRY)
    : retained("unknown", "head-moved", HISTORY_HEAD_MOVED(action.kind), REVIEW_ONLY);
}

const REVIEW_ONLY = ["export", "discard"] as const;
const RETRY = ["retry-same-id", "export", "discard"] as const;
const APPLY = ["apply-reviewed", "export", "discard"] as const;
const INCOMPATIBLE =
  "Written by a different OpenPCB build or design schema; it is never resent. Export or discard it.";
const ORPHANED = "The design no longer exists. Export or discard this edit.";
const EVIDENCE_MISMATCH = "the server's answer does not match this record";
const HISTORY_NOT_APPLIED = (kind: "undo" | "redo") =>
  `The design has not changed since this ${kind} was sent, so it was not applied. It can be resent once with its original revision guard.`;
const HISTORY_HEAD_MOVED = (kind: "undo" | "redo") =>
  `The design changed after this ${kind} was sent; it may have applied. Check the design and repeat the ${kind} yourself if still wanted.`;

function compatVerdict(
  stamp: RecoveryCompat,
  current: RecoveryCompat | null,
): "compatible" | "incompatible" | "unknown" {
  if (
    stamp.recordEpoch !== DESIGNER_RECOVERY_EPOCH ||
    stamp.schemaHead === null ||
    stamp.commandEpoch === null
  )
    return "incompatible";
  if (current === null) return "unknown";
  if (
    current.schemaHead !== stamp.schemaHead ||
    current.commandEpoch !== stamp.commandEpoch
  )
    return "incompatible";
  return stamp.appVersion !== null &&
    current.appVersion !== null &&
    stamp.appVersion !== current.appVersion
    ? "incompatible"
    : "compatible";
}

function retained(
  state: RetainedState,
  label: RecoveryLabel,
  message: string,
  actions: readonly RecoveryActionName[],
): Retained {
  return { autoClear: false, label, state, message, actions };
}

function unavailable(reason: string): Retained {
  return retained(
    "unknown",
    "unavailable",
    `Could not check whether this edit was saved (${reason}). Nothing was retried.`,
    ["check-status", "export", "discard"],
  );
}

/** Never sent; history is never re-issued from here (the assistant shares its session). */
function notSent(record: DesignerRecoveryRecordV1): Retained {
  const kind = record.action.kind;
  return kind === "undo" || kind === "redo"
    ? retained(
        "cancelled",
        "not-sent",
        `This ${kind} was never sent. Repeat it yourself if still wanted.`,
        REVIEW_ONLY,
      )
    : retained(
        "cancelled",
        "not-sent",
        "This edit was never sent. Review it against the current design before applying.",
        APPLY,
      );
}

function fromLookup(
  commandType: string,
  lookup: DesignerCommandLookup,
): RecoveryClassification {
  if (lookup.status === "missing")
    return retained(
      "unknown",
      "not-recorded",
      "The server has no record of this edit. It can be resent once with its original id.",
      RETRY,
    );
  if (lookup.status === "mismatch" || lookup.commandType !== commandType)
    return retained(
      "unknown",
      "mismatch",
      "Its id was recorded for a different design, session or command; it is never resent.",
      REVIEW_ONLY,
    );
  if (lookup.status === "found-unparsed")
    return lookup.rawOk
      ? saved(lookup.commandType, lookup.appliedRevision, null)
      : rejected(`Edit rejected (${lookup.rawCode ?? "unknown code"})`);
  const result = lookup.result;
  if (result.ok)
    return saved(lookup.commandType, lookup.appliedRevision, result);
  if (result.code === "REVISION_CONFLICT" && result.conflict.actual >= 0)
    return retained(
      "conflicted",
      "conflicted",
      "Not applied: the design changed before this edit arrived. Review it before applying.",
      APPLY,
    );
  return rejected(dispatchFailureMessage("Edit", result));
}

function saved(
  commandType: string,
  revision: number,
  result: DesignerDispatchResult | null,
): RecoveryClassification {
  return {
    autoClear: true,
    label: "saved",
    message: "Already saved.",
    commandType,
    revision,
    result,
  };
}

function rejected(message: string): Retained {
  return retained("failed", "rejected", `Not applied: ${message}`, REVIEW_ONLY);
}

function fromBomHead(
  action: Extract<DesignerRecoveryRecordV1["action"], { kind: "bom_override" }>,
  head: DesignerRecoveryHead,
): Retained {
  if (head.refdesPartId === undefined)
    return unavailable("the server did not report the reference's part");
  if (head.refdesPartId !== action.partId)
    return retained(
      "conflicted",
      "binding-changed",
      `${action.refdes} now refers to a different part. Review before applying.`,
      APPLY,
    );
  if (head.headRevision !== action.observedHead)
    return retained(
      "unknown",
      "head-moved",
      "The design changed after this BOM edit was sent; it may have applied. Review before applying.",
      APPLY,
    );
  return retained(
    "unknown",
    "unverifiable",
    "BOM edits leave no server record, so this cannot be confirmed. It can be resent once; the part guard prevents it landing on another part.",
    RETRY,
  );
}
