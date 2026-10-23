import { memberToken } from "./bind-input";
import type { BindResult } from "./bind";
import type { NetDependentsCensus } from "./census";
import { readNetIdentitySeqWatermark, writeNetIdentityRetired, type NetIdentityDb } from "./state-store";
import { persistIdentityBinding, type NetIdentitySyncResult } from "./sync";
import { isDurableNetId, seqOf, type ActiveNetRecord, type NetIdentityState } from "./types";
import { requireValid } from "./validation";

export function priorNetOwners(active: readonly ActiveNetRecord[]): Map<string, string> {
  const owners = new Map<string, string>(), ids = new Set<string>();
  for (const record of active) {
    requireValid(isDurableNetId(record.id) && !ids.has(record.id), "priorOwner.id", "invalid or duplicate durable id");
    ids.add(record.id);
    for (const member of record.members) {
      requireValid(["pin", "wire", "label", "primitive"].includes(member.kind) && typeof member.id === "string" && member.id.trim().length > 0,
        "priorOwner.member", "invalid member");
      const token = memberToken(member);
      requireValid(!owners.has(token), "priorOwner.member", `duplicate ownership of ${token}`);
      owners.set(token, record.id);
    }
  }
  return owners;
}

export function persistReplayIdentity(
  tx: NetIdentityDb, designId: string, priorState: NetIdentityState,
  previousActive: readonly ActiveNetRecord[], bind: BindResult, census: NetDependentsCensus,
  revision: number, timestamp: string,
): NetIdentitySyncResult {
  requireValid(priorState.designId === designId && priorState.status === "active", "replay.state", "requires matching active prior state");
  const nextSeq = Math.max(bind.nextSeq, readNetIdentitySeqWatermark(tx, designId));
  const result = persistIdentityBinding(tx, priorState, previousActive, { ...bind, nextSeq }, census, revision, timestamp);
  const active = new Set(bind.nextActive.map((row) => row.id));
  const retired = new Set(bind.retirements.map((row) => row.id));
  for (const old of [...priorState.active].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (active.has(old.id) || retired.has(old.id)) continue;
    writeNetIdentityRetired(tx, {
      designId, netId: old.id, seq: seqOf(old.id)!, reason: "history", successorIds: [],
      displayName: old.name, retiredAtRevision: revision, createdAt: timestamp, updatedAt: timestamp,
    });
    if (census.count(old.id) > 0) result.events.push({
      kind: "removed", netId: old.id, netName: old.name, hasDependents: true,
      dependents: census.get(old.id),
    });
  }
  return result;
}
