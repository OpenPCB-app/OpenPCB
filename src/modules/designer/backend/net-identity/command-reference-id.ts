import { and, eq } from "drizzle-orm";
import type { DesignerSchematicProjection } from "../../../../sdks";
import type { DesignerNetReferenceDanglingResult } from "../../../../sdks/designer/types";
import { netIdentityRetired } from "../schema";
import type { NetIdentityDb } from "./state-store";
import { isDurableNetId, isDurableNetIdOf, isLoneNetId } from "./types";
import { parseStoredJson, validateRetired } from "./validation";

export type NetReferenceFailure = DesignerNetReferenceDanglingResult;
export type NetReferenceJudge = (netId: string | null, field: string) => NetReferenceFailure | null;

export function danglingReference(
  field: string, netId: string | null, reason: NetReferenceFailure["reason"], successorIds: string[] = [],
): NetReferenceFailure {
  return {
    ok: false, code: "NET_REFERENCE_DANGLING", field, netId, reason, successorIds,
    detail: `${field}: net ${JSON.stringify(netId)} is ${reason}. Select an active net or clear the reference.`,
  };
}

function retiredSuccessors(tx: NetIdentityDb, designId: string, netId: string): string[] | null {
  const row = tx.select().from(netIdentityRetired).where(and(
    eq(netIdentityRetired.designId, designId), eq(netIdentityRetired.netId, netId),
  )).get();
  if (!row) return null;
  const { successorIdsJson, ...fields } = row;
  return validateRetired({
    ...fields, successorIds: parseStoredJson(successorIdsJson, "retired.successorIdsJson"),
  }).successorIds;
}

export function createNetReferenceJudge(
  tx: NetIdentityDb, designId: string, projection: DesignerSchematicProjection,
): NetReferenceJudge {
  const active = new Set(projection.nets.filter((net) =>
    isDurableNetIdOf(net.id, designId) || isLoneNetId(net.id)).map((net) => net.id));
  return (netId, field) => {
    if (netId === null || active.has(netId)) return null;
    if (netId.startsWith("pending:")) return danglingReference(field, netId, "pending");
    if (isDurableNetId(netId)) {
      if (!isDurableNetIdOf(netId, designId)) return danglingReference(field, netId, "foreign-design");
      const successors = retiredSuccessors(tx, designId, netId);
      return danglingReference(field, netId, successors ? "retired" : "unknown", successors ?? []);
    }
    if (isLoneNetId(netId)) {
      const successors = [...new Set(projection.nets.filter((net) =>
        net.pinIds.includes(netId.slice(3))).map((net) => net.id))].sort();
      return danglingReference(field, netId, "retired", successors);
    }
    return danglingReference(field, netId, "foreign");
  };
}
