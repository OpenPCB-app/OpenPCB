import type { DesignEntity } from "../contracts/entity";
import type { DesignId, EntityId } from "../contracts/ids";
import type { NetMemberRef } from "../contracts/patch";
import type { Revision } from "../contracts/revision";

export interface DesignHeadState {
  designId: DesignId;
  revision: Revision;
  nextAutoNetOrdinals: Record<string, number>;
  referenceCounters: Record<string, number>;
}

export interface DesignWorld {
  head: DesignHeadState;
  entities: Map<EntityId, DesignEntity>;
  netMembers: NetMemberRef[];
}

export function cloneWorld(world: DesignWorld): DesignWorld {
  return {
    head: {
      ...world.head,
      nextAutoNetOrdinals: { ...world.head.nextAutoNetOrdinals },
      referenceCounters: { ...world.head.referenceCounters },
    },
    entities: new Map(
      [...world.entities.entries()].map(([id, entity]) => [
        id,
        structuredClone(entity),
      ]),
    ),
    netMembers: structuredClone(world.netMembers),
  };
}
