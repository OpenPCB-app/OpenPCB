import type { ComponentKind } from "./component-kind";
import type { DesignEntity } from "./entity";
import type { DesignId, EntityId } from "./ids";
import type { Revision } from "./revision";

export interface NetMemberRef {
  netId: EntityId;
  memberEntityId: EntityId;
  memberKind: "wire" | "part_pin";
  pinKey?: string;
}

export type DesignPatch =
  | { op: "upsert_entity"; entity: DesignEntity }
  | { op: "delete_entity"; entityId: EntityId }
  | {
      op: "set_component";
      entityId: EntityId;
      component: ComponentKind;
      value: unknown;
    }
  | { op: "remove_component"; entityId: EntityId; component: ComponentKind }
  | { op: "replace_net_members"; designId: DesignId; members: NetMemberRef[] }
  | {
      op: "set_design_head";
      designId: DesignId;
      revision: Revision;
      nextAutoNetOrdinals: Record<string, number>;
      referenceCounters: Record<string, number>;
    };
