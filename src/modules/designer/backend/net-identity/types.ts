import { createHash } from "node:crypto";
import type { ElectricalMember } from "../../../../shared/electrical-identity/types";

export const NET_IDENTITY_SCHEMA_VERSION = 1;
export const NET_IDENTITY_MIGRATOR_VERSION = 1;
export type NetIdentityStatus = "active" | "migration_failed" | "legacy_restored";
export type NetIdentityMode = "durable" | "legacy";
export type NetNameSource = "auto" | "override" | "gnd" | "pwr" | "portal" | "label";

export interface ActiveNetRecord {
  id: string;
  name: string;
  nameSource: NetNameSource;
  members: ElectricalMember[];
  displayOverride?: string;
}

export type NetRetirementReason = "removed" | "split" | "merged" | "reconfigured" | "history";
export type QuarantineReason =
  | "root_only" | "conflict" | "short" | "no_evidence" | "stale_root"
  | "unknown_name" | "ambiguous_name" | "assignment_conflict" | "diff_pair_collapsed";
export type NetIdentityReferenceKind =
  | "trace" | "via" | "free_pad" | "zone" | "net_class_assignment"
  | "length_group" | "diff_pair" | "drc_rule";

export interface NetIdentityMigrationReport {
  schemaVersion: 1;
  migratorVersion: number;
  revisionBefore: number;
  revisionAfter: number;
  netsAllocated: number;
  references: {
    total: number;
    bound: { rootAndContact: number; rootAndPour: number; contact: number; nameHint: number; autoNameHint: number };
    quarantined: Partial<Record<QuarantineReason, number>>;
  };
  historiesArchived: number;
  boardSettings: "migrated" | "absent" | "unparseable";
}

export interface NetIdentityProvenance {
  origin: "native" | "legacy-migration" | "kicad-import";
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
  updatedAt: string;
}

export interface NetIdentityRetiredRecord {
  designId: string;
  netId: string;
  seq: number;
  reason: NetRetirementReason;
  successorIds: string[];
  displayName: string | null;
  retiredAtRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface NetIdentityQuarantineRecord {
  designId: string;
  refKind: NetIdentityReferenceKind;
  refId: string;
  legacyValue: string;
  reason: QuarantineReason;
  candidates: string[];
  suggestedNetId: string | null;
  createdAt: string;
}

/** The payload remains opaque so every source column survives restoration. */
export interface NetIdentityBackup {
  designId: string;
  schemaVersion: 1;
  revision: number;
  payloadJson: string;
  sha256: string;
  createdAt: string;
}

export class NetIdentityStateInvalidError extends Error {
  readonly code = "NET_IDENTITY_STATE_INVALID";

  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = "NetIdentityStateInvalidError";
  }
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const DURABLE_ID = /^net:([a-z2-7]{10}):([1-9][0-9]*)$/;

export function designNetSalt(designId: string): string {
  if (typeof designId !== "string" || !designId.trim()) {
    throw new NetIdentityStateInvalidError("designId", "must be a non-empty string");
  }
  const bytes = createHash("sha256").update(designId, "utf8").digest();
  let salt = "";
  for (let bit = 0; bit < 50; bit += 5) {
    const offset = bit % 8;
    const pair = (bytes[Math.floor(bit / 8)]! << 8) | bytes[Math.floor(bit / 8) + 1]!;
    salt += BASE32[(pair >>> (11 - offset)) & 31];
  }
  return salt;
}

export function formatDurableNetId(salt: string, seq: number): string {
  if (typeof salt !== "string" || salt.length !== 10 || !/^[a-z2-7]+$/.test(salt)) {
    throw new NetIdentityStateInvalidError("salt", "must contain 10 lowercase base32 characters");
  }
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new NetIdentityStateInvalidError("seq", "must be a positive safe integer");
  }
  return `net:${salt}:${seq}`;
}

export function seqOf(id: string): number | null {
  if (typeof id !== "string") return null;
  const match = DURABLE_ID.exec(id);
  if (!match || match[0] !== id) return null;
  const seq = Number(match[2]);
  return Number.isSafeInteger(seq) ? seq : null;
}

export function isDurableNetId(id: string): boolean {
  return seqOf(id) !== null;
}

export function isDurableNetIdOf(id: string, designId: string): boolean {
  return isDurableNetId(id) && id.startsWith(`net:${designNetSalt(designId)}:`);
}

export function isLoneNetId(id: string): boolean {
  return typeof id === "string" && /^nc:.+$/.exec(id)?.[0] === id;
}

export function isPendingNetId(id: string): boolean {
  return typeof id === "string" && /^pending:\d+$/.exec(id)?.[0] === id;
}
