import type { DesignEntity } from "../../contracts/entity";
import type { DesignPatch, NetMemberRef } from "../../contracts/patch";

export function upsertEntity(entity: DesignEntity): DesignPatch {
  return { op: "upsert_entity", entity };
}

export function deleteEntity(entityId: string): DesignPatch {
  return { op: "delete_entity", entityId };
}

export function replaceNetMembers(
  designId: string,
  members: NetMemberRef[],
): DesignPatch {
  return { op: "replace_net_members", designId, members };
}
