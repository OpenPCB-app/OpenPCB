import type { EntityId } from "../ids";

export interface DeleteEntitiesCommand {
  type: "delete_entities";
  entityIds: EntityId[];
}
