import type { ComponentKind } from "./component-kind";
import type { ComponentTypeMap } from "./component-map";
import type { EntityKind } from "./entity-kind";
import type { DesignId, EntityId } from "./ids";
import type { Revision } from "./revision";

export type ComponentBag = Partial<{ [K in ComponentKind]: ComponentTypeMap[K] }>;

export interface DesignEntity {
  id: EntityId;
  designId: DesignId;
  kind: EntityKind;
  createdRevision: Revision;
  updatedRevision: Revision;
  components: ComponentBag;
}
