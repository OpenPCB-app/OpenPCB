// Crash-recovery record for one designer edit intent (OPENPCB-103 §3.4.1).
//
// A record is journaled before its edit is sent and removed once the outcome is
// known. The decoder is strict on purpose: anything it does not recognise (a
// newer build's record, a tampered file) is reported as unsupported and kept
// byte-for-byte; it is never re-encoded, resent or deleted automatically.

import type { BomOverridePatch, DesignerCommand } from "../../../../sdks";

export const DESIGNER_RECOVERY_SCHEMA = "openpcb.designer-recovery";
export const DESIGNER_RECOVERY_VERSION = 1;
/** Client record-format epoch; extra guard alongside the server compat stamp. */
export const DESIGNER_RECOVERY_EPOCH = 1;

export interface RecoveryCompat {
  /** From `GET /recovery/compat`; null = unknown, so the record is review-only on recovery. */
  schemaHead: string | null;
  commandEpoch: number | null;
  recordEpoch: number;
  appVersion: string | null;
}
export interface SentCommand {
  commandId: string;
  baseRevision: number;
  issuedAt: number;
}

/** `sent` / `expectedRevision` / `observedHead` exist exactly when the phase is "sending". */
export type RecoveredAction =
  | {
      kind: "command";
      sessionId: string;
      command: DesignerCommand;
      sent?: SentCommand;
    }
  | { kind: "undo" | "redo"; sessionId: string; expectedRevision?: number }
  | {
      kind: "bom_override";
      refdes: string;
      patch: BomOverridePatch;
      /** Resolved from the BOM projection at enqueue (`BomLineRef.partId`). */
      partId: string | null;
      /** Lane/head revision at send. */
      observedHead?: number;
    };

export type RecoveryLastKnownState =
  "queued" | "sending" | "unknown" | "conflicted" | "failed" | "cancelled";

export interface DesignerRecoveryRecordV1 {
  schema: typeof DESIGNER_RECOVERY_SCHEMA;
  version: typeof DESIGNER_RECOVERY_VERSION;
  compat: RecoveryCompat;
  /** Stable across same-id retry, net-merge re-send and fresh-id reapply. */
  recordId: string;
  designId: string;
  /** ISO UTC, informational only; ordering uses `seq`. */
  createdAt: string;
  /** Journal-global monotonic order, continued from the largest loaded `seq`. */
  seq: number;
  phase: "queued" | "sending";
  action: RecoveredAction;
  lastKnown: { state: RecoveryLastKnownState; message?: string; at: string };
}

export const recoveryKey = (designId: string, recordId: string): string =>
  `v1/${designId}/${recordId}`;

export type DecodedRecord =
  | { ok: true; record: DesignerRecoveryRecordV1 }
  | { ok: false; reason: "malformed" | "future-version" | "key-mismatch" };

/** Throws rather than journal a record this build could not decode again. */
export function encodeRecord(record: DesignerRecoveryRecordV1): string {
  const value = JSON.stringify(record);
  const decoded = decodeRecord(
    recoveryKey(record.designId, record.recordId),
    value,
  );
  if (!decoded.ok)
    throw new Error(`Invalid designer recovery record (${decoded.reason})`);
  return value;
}

export function decodeRecord(key: string, value: string): DecodedRecord {
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    return MALFORMED;
  }
  if (!isObject(data) || data.schema !== DESIGNER_RECOVERY_SCHEMA)
    return MALFORMED;
  if (
    typeof data.version === "number" &&
    Number.isSafeInteger(data.version) &&
    data.version > DESIGNER_RECOVERY_VERSION
  )
    return { ok: false, reason: "future-version" };
  if (!isRecordV1(data)) return MALFORMED;
  if (recoveryKey(data.designId, data.recordId) !== key)
    return { ok: false, reason: "key-mismatch" };
  return { ok: true, record: data };
}

const MALFORMED: DecodedRecord = { ok: false, reason: "malformed" };
type Json = Record<string, unknown>;

const RECORD_KEYS = [
  "schema",
  "version",
  "compat",
  "recordId",
  "designId",
  "createdAt",
  "seq",
  "phase",
  "action",
  "lastKnown",
] as const;
const COMPAT_KEYS = ["schemaHead", "commandEpoch", "recordEpoch", "appVersion"];
const SENT_KEYS = ["commandId", "baseRevision", "issuedAt"];
const LAST_KNOWN_KEYS = ["state", "message", "at"];
const LAST_KNOWN_STATES: readonly unknown[] = [
  "queued",
  "sending",
  "unknown",
  "conflicted",
  "failed",
  "cancelled",
];

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (rec: Json, allowed: readonly string[]): boolean =>
  Object.keys(rec).every((key) => allowed.includes(key));
/** Matches the server's recovery-key bound: 1..128 characters. */
const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 128;
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 256;
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isEpoch = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);
const nullableString = (value: unknown): boolean =>
  value === null || typeof value === "string";

/** Typed as a full record so a new `BomOverridePatch` field cannot go unvalidated. */
const BOM_PATCH_FIELDS: Record<keyof BomOverridePatch, (v: unknown) => boolean> =
  {
    manufacturer: nullableString,
    manufacturerPartNumber: nullableString,
    lcscPartNumber: nullableString,
    supplier: nullableString,
    unitPrice: (v) => v === null || (typeof v === "number" && Number.isFinite(v)),
    currency: nullableString,
    dnp: (v) => typeof v === "boolean",
    assemblySide: (v) => v === null || v === "top" || v === "bottom",
    notes: nullableString,
  };

function isRecordV1(data: Json): data is Json & DesignerRecoveryRecordV1 {
  return (
    onlyKeys(data, RECORD_KEYS) &&
    data.version === DESIGNER_RECOVERY_VERSION &&
    isId(data.recordId) &&
    isId(data.designId) &&
    isText(data.createdAt) &&
    isCount(data.seq) &&
    (data.phase === "queued" || data.phase === "sending") &&
    isCompat(data.compat) &&
    isAction(data.action, data.phase === "sending") &&
    isLastKnown(data.lastKnown)
  );
}

function isCompat(value: unknown): boolean {
  return (
    isObject(value) &&
    onlyKeys(value, COMPAT_KEYS) &&
    (value.schemaHead === null || isText(value.schemaHead)) &&
    (value.commandEpoch === null || isEpoch(value.commandEpoch)) &&
    isEpoch(value.recordEpoch) &&
    (value.appVersion === null || isText(value.appVersion))
  );
}

function isLastKnown(value: unknown): boolean {
  return (
    isObject(value) &&
    onlyKeys(value, LAST_KNOWN_KEYS) &&
    LAST_KNOWN_STATES.includes(value.state) &&
    isText(value.at) &&
    (!("message" in value) || typeof value.message === "string")
  );
}

/** A queued record was never sent, so it must not carry the ids of a send. */
function sendIds(rec: Json, key: string, sending: boolean, valid: boolean) {
  return sending ? valid : !(key in rec);
}

function isAction(value: unknown, sending: boolean): boolean {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case "command":
      return (
        onlyKeys(value, ["kind", "sessionId", "command", "sent"]) &&
        isId(value.sessionId) &&
        isObject(value.command) &&
        isId(value.command.type) &&
        sendIds(value, "sent", sending, isSent(value.sent))
      );
    case "undo":
    case "redo":
      return (
        onlyKeys(value, ["kind", "sessionId", "expectedRevision"]) &&
        isId(value.sessionId) &&
        sendIds(value, "expectedRevision", sending, isCount(value.expectedRevision))
      );
    case "bom_override":
      return (
        onlyKeys(value, ["kind", "refdes", "patch", "partId", "observedHead"]) &&
        isId(value.refdes) &&
        (value.partId === null || isId(value.partId)) &&
        isBomPatch(value.patch) &&
        sendIds(value, "observedHead", sending, isCount(value.observedHead))
      );
    default:
      return false;
  }
}

function isSent(value: unknown): boolean {
  return (
    isObject(value) &&
    onlyKeys(value, SENT_KEYS) &&
    isId(value.commandId) &&
    isCount(value.baseRevision) &&
    typeof value.issuedAt === "number" &&
    Number.isFinite(value.issuedAt)
  );
}

function isBomPatch(value: unknown): boolean {
  if (!isObject(value)) return false;
  return Object.entries(value).every(([key, field]) => {
    const valid: ((v: unknown) => boolean) | undefined =
      Object.prototype.hasOwnProperty.call(BOM_PATCH_FIELDS, key)
        ? BOM_PATCH_FIELDS[key as keyof BomOverridePatch]
        : undefined;
    return valid !== undefined && valid(field);
  });
}
