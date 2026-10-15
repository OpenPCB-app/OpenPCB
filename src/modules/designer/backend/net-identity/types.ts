/**
 * Durable net identity (H08, OPENPCB-56 §3.2): persisted row shapes and the id
 * format. Three id families are valid net ids in a durable design:
 * - `net:<salt>:<seq>` — durable; the only form ever persisted in the state row.
 * - `nc:<pinId>` — a lone unwired pin; active but never persisted.
 * - `pending:<k>` — mid-batch read mode only; never persisted, rejected at the
 *   command boundary.
 * Anything else (`pt:…`, `w:…`) is a legacy or foreign id.
 */
import { createHash } from "node:crypto";
import type { ElectricalMember } from "../../../../shared/electrical-identity";
import type {
  pcbEntities,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicPrimitives,
  schematicWires,
  sessionHistories,
} from "../schema";

export const NET_IDENTITY_SCHEMA_VERSION = 1;
/** Bump ⇒ `migration_failed` designs retry automatically (§3.10.1). */
export const NET_IDENTITY_MIGRATOR_VERSION = 1;

export type NetIdentityStatus = "active" | "migration_failed" | "legacy_restored";
/** durable ⇔ the state row exists with status `active`. */
export type NetIdentityMode = "durable" | "legacy";

/** One entry of `state.active_json` (durable ids only). */
export interface ActiveNetRecord {
  /** `net:<salt>:<seq>` */
  id: string;
  /** Display name at the last commit; diagnostics only. */
  name: string;
  /** Canonical: sorted by `JSON.stringify([kind, id])`. */
  members: ElectricalMember[];
  /** H14 import name; applies only while the net is auto-named. */
  displayOverride?: string;
}

export type QuarantineReason =
  | "root_only"
  | "conflict"
  | "short"
  | "no_evidence"
  | "stale_root"
  | "unknown_name"
  | "ambiguous_name"
  | "assignment_conflict"
  | "diff_pair_collapsed";

export type QuarantineRefKind =
  | "trace"
  | "via"
  | "free_pad"
  | "zone"
  | "net_class_assignment"
  | "length_group"
  | "diff_pair"
  | "drc_rule";

/** Persisted in provenance; written by the legacy migration (§3.10). */
export interface NetIdentityMigrationReport {
  schemaVersion: 1;
  migratorVersion: number;
  revisionBefore: number;
  revisionAfter: number;
  netsAllocated: number;
  references: {
    total: number;
    bound: {
      rootAndContact: number;
      rootAndPour: number;
      contact: number;
      nameHint: number;
      autoNameHint: number;
    };
    quarantined: Partial<Record<QuarantineReason, number>>;
  };
  historiesArchived: number;
  boardSettings: "migrated" | "absent" | "unparseable";
}

export type NetIdentityOrigin = "native" | "legacy-migration" | "kicad-import";

export interface NetIdentityProvenance {
  origin: NetIdentityOrigin;
  createdAt: string;
  migratorVersion: number;
  migration?: NetIdentityMigrationReport;
  restoredAt?: string;
}

export interface NetIdentityState {
  designId: string;
  schemaVersion: 1;
  status: NetIdentityStatus;
  nextSeq: number;
  active: ActiveNetRecord[];
  provenance: NetIdentityProvenance;
  lastError: string | null;
}

export type NetRetirementReason =
  | "removed"
  | "split"
  | "merged"
  | "reconfigured"
  | "history";

/** One retirement-ledger row. Ledger rows are not history-patched; active wins. */
export interface RetiredNetRecord {
  designId: string;
  netId: string;
  /** Always `seqOf(netId)`. */
  seq: number;
  reason: NetRetirementReason;
  successorIds: string[];
  displayName: string | null;
  retiredAtRevision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Immutable provenance record. It is *open* iff the reference at
 * `(refKind, refId)` still holds `legacyValue` — nothing is flagged, so it is
 * undo-safe.
 */
export interface QuarantineRecord {
  designId: string;
  refKind: QuarantineRefKind;
  refId: string;
  legacyValue: string;
  reason: QuarantineReason;
  candidates: string[];
  suggestedNetId: string | null;
  createdAt: string;
}

export const NET_IDENTITY_BACKUP_FORMAT = "openpcb.net-identity-backup/2";

/**
 * Everything restore must put back (§3.2), every row with every column as
 * read. Serialised with a fixed key order and every array ordered by `id`.
 */
export interface NetIdentityBackupPayload {
  format: typeof NET_IDENTITY_BACKUP_FORMAT;
  designId: string;
  revision: number;
  schematic: {
    parts: (typeof schematicParts.$inferSelect)[];
    pins: (typeof schematicPins.$inferSelect)[];
    wires: (typeof schematicWires.$inferSelect)[];
    labels: (typeof schematicLabels.$inferSelect)[];
    primitives: (typeof schematicPrimitives.$inferSelect)[];
  };
  pcbEntities: (typeof pcbEntities.$inferSelect)[];
  sessionHistories: (typeof sessionHistories.$inferSelect)[];
}

export interface NetIdentityBackup {
  designId: string;
  schemaVersion: number;
  revision: number;
  payloadJson: string;
  sha256: string;
  createdAt: string;
  /** sha256 matches `payloadJson` and the payload is this design's, at `revision`. */
  verified: boolean;
  /** Null unless `verified`. */
  payload: NetIdentityBackupPayload | null;
}

// --- id format -----------------------------------------------------------------

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const SALT_LENGTH = 10;
const SALT_PATTERN = /^[a-z2-7]{10}$/;
const DURABLE_PATTERN = /^net:([a-z2-7]{10}):([1-9][0-9]*)$/;
const LONE_PATTERN = /^nc:.+$/;
const PENDING_PATTERN = /^pending:\d+$/;

/**
 * Lowercase RFC 4648 base32 (no padding) of the first 50 bits of
 * `sha256(designId)`: deterministic, so migration is reproducible and an id
 * pasted from another design is recognisably foreign.
 */
export function designNetSalt(designId: string): string {
  const digest = createHash("sha256").update(designId, "utf8").digest();
  let salt = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of digest) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && salt.length < SALT_LENGTH) {
      salt += BASE32_ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    if (salt.length === SALT_LENGTH) return salt;
    // Keep only the unconsumed bits so the shift never overflows 32 bits.
    buffer &= (1 << bits) - 1;
  }
  return salt;
}

export function formatDurableNetId(salt: string, seq: number): string {
  if (!SALT_PATTERN.test(salt)) {
    throw new RangeError(`Invalid net identity salt: ${JSON.stringify(salt)}`);
  }
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(`Invalid net identity seq: ${seq}`);
  }
  return `net:${salt}:${seq}`;
}

/**
 * Any salt. The seq must also be a safe integer, so `seqOf(id) !== null`
 * exactly when this holds.
 */
export function isDurableNetId(id: string): boolean {
  return seqOf(id) !== null;
}

/** A durable id carrying this design's salt; an id from another design fails. */
export function isDurableNetIdOf(id: string, designId: string): boolean {
  const match = DURABLE_PATTERN.exec(id);
  return (
    match !== null &&
    Number.isSafeInteger(Number(match[2])) &&
    match[1] === designNetSalt(designId)
  );
}

export function isLoneNetId(id: string): boolean {
  return LONE_PATTERN.test(id);
}

export function isPendingNetId(id: string): boolean {
  return PENDING_PATTERN.test(id);
}

/** The seq of a durable id (any salt); null for every other id. */
export function seqOf(id: string): number | null {
  const match = DURABLE_PATTERN.exec(id);
  if (!match) return null;
  const seq = Number(match[2]);
  return Number.isSafeInteger(seq) ? seq : null;
}
