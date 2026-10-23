import { eq } from "drizzle-orm";
import type { DesignerCommand } from "../../../../sdks/designer";
import type { DesignerNetIdentityEvent } from "../../../../sdks/designer/net-identity";
import { loadSchematicSource } from "../projection-read";
import { deriveNetComponents } from "../projection-world";
import { designHeads, netIdentityRetired } from "../schema";
import type { BindResult, BoundNet } from "./bind";
import { lazyCensus, type NetDependentsCensus } from "./census";
import { loadNetReferenceSource } from "./census-source";
import { buildNetIdentityEvents } from "./events";
import { bindSchematicIdentity } from "./projection";
import {
  readNetIdentitySeqWatermark, readNetIdentityState, readRawNetIdentityState,
  writeNetIdentityRetired, writeNetIdentityState, type NetIdentityDb,
} from "./state-store";
import {
  designNetSalt, isDurableNetIdOf, NET_IDENTITY_MIGRATOR_VERSION, seqOf,
  type ActiveNetRecord, type NetIdentityState,
} from "./types";
import { requireValid, safeInteger } from "./validation";

export interface NetIdentitySyncResult { changed: boolean; events: DesignerNetIdentityEvent[] }

function activeState(tx: NetIdentityDb, designId: string): NetIdentityState {
  const state = readNetIdentityState(tx, designId);
  requireValid(state?.status === "active", "identity.state", "requires active identity state");
  return state;
}

function bindCurrent(tx: NetIdentityDb, state: NetIdentityState, previousActive = state.active): {
  bind: BindResult; census: NetDependentsCensus; revision: number;
} {
  const source = loadSchematicSource(tx, state.designId);
  requireValid(source, "identity.designId", "design does not exist");
  const derived = deriveNetComponents(source.parts, source.wires, source.labels, source.primitives);
  const census = lazyCensus(() => loadNetReferenceSource(tx, state.designId));
  const { bind } = bindSchematicIdentity(source, derived, {
    previousActive, salt: designNetSalt(state.designId),
    seqWatermark: readNetIdentitySeqWatermark(tx, state.designId), mode: "commit",
    dependentCount: (id) => census.count(id),
  });
  return { bind, census, revision: source.revision };
}

/** Caller owns the transaction, including rollback if event validation fails. */
export function persistIdentityBinding(
  tx: NetIdentityDb, state: NetIdentityState, previousActive: readonly ActiveNetRecord[],
  bind: BindResult, census: NetDependentsCensus, revision: number, timestamp: string,
): NetIdentitySyncResult {
  safeInteger(revision, "identity.revision");
  requireValid(typeof timestamp === "string" && timestamp.trim().length > 0, "identity.timestamp", "must be non-blank");
  const nextSeq = Math.max(bind.nextSeq, readNetIdentitySeqWatermark(tx, state.designId));
  writeNetIdentityState(tx, { ...state, active: bind.nextActive, nextSeq, updatedAt: timestamp });
  const previous = new Map(previousActive.map((record) => [record.id, record]));
  for (const row of bind.retirements) {
    const old = previous.get(row.id);
    requireValid(old, "identity.retirement", `missing previous record ${row.id}`);
    writeNetIdentityRetired(tx, {
      designId: state.designId, netId: row.id, seq: seqOf(row.id)!, reason: row.reason,
      successorIds: [...row.successorIds], displayName: old.name, retiredAtRevision: revision,
      createdAt: timestamp, updatedAt: timestamp,
    });
  }
  return { changed: true, events: buildNetIdentityEvents(previousActive, bind, census) };
}

export function syncNetIdentity(tx: NetIdentityDb, designId: string, revision: number, timestamp: string): NetIdentitySyncResult {
  safeInteger(revision, "identity.revision");
  requireValid(typeof timestamp === "string" && timestamp.trim().length > 0, "identity.timestamp", "must be non-blank");
  const state = activeState(tx, designId);
  const { bind, census } = bindCurrent(tx, state);
  return bind.inSync ? { changed: false, events: [] }
    : persistIdentityBinding(tx, state, state.active, bind, census, revision, timestamp);
}

export function initializeNetIdentity(
  tx: NetIdentityDb, designId: string, origin: "native" | "kicad-import", timestamp: string,
): readonly BoundNet[] {
  requireValid(tx.select({ id: designHeads.id }).from(designHeads).where(eq(designHeads.id, designId)).get(), "identity.designId", "design does not exist");
  requireValid(!readRawNetIdentityState(tx, designId), "identity.state", "already initialized");
  requireValid(!tx.select({ id: netIdentityRetired.netId }).from(netIdentityRetired).where(eq(netIdentityRetired.designId, designId)).get(), "identity.ledger", "allocation history already exists");
  const state: NetIdentityState = {
    designId, schemaVersion: 1, status: "active", nextSeq: 1, active: [], lastError: null, updatedAt: timestamp,
    provenance: { origin, createdAt: timestamp, migratorVersion: NET_IDENTITY_MIGRATOR_VERSION },
  };
  writeNetIdentityState(tx, state);
  const { bind, census, revision } = bindCurrent(tx, state);
  if (!bind.inSync) persistIdentityBinding(tx, state, [], bind, census, revision, timestamp);
  return bind.nets;
}

export function setNetDisplayOverride(
  tx: NetIdentityDb, designId: string, netId: string, name: string | null,
): readonly BoundNet[] {
  const state = activeState(tx, designId);
  requireValid(isDurableNetIdOf(netId, designId) && state.active.some((row) => row.id === netId), "identity.netId", "requires own active durable id");
  requireValid(name === null || typeof name === "string", "identity.displayOverride", "must be a string or null");
  const displayOverride = name === null ? null : name.trim();
  requireValid(displayOverride === null || displayOverride.length >= 1 && displayOverride.length <= 128 &&
    !/^Net_(pending_)?\d+(_\d+)?$/.test(displayOverride) && !displayOverride.startsWith("unconnected-("),
  "identity.displayOverride", "invalid or reserved display name");
  const previous = state.active.map((row) => {
    if (row.id !== netId) return row;
    const { displayOverride: _old, ...record } = row;
    return displayOverride === null ? record : { ...record, displayOverride };
  });
  const { bind, census, revision } = bindCurrent(tx, state, previous);
  persistIdentityBinding(tx, state, previous, bind, census, revision, state.updatedAt);
  return bind.nets;
}

export function isSchematicNeutralCommand(command: DesignerCommand): boolean {
  return command.type.startsWith("pcb_") || command.type === "batch_commands" && command.commands.every(isSchematicNeutralCommand);
}
