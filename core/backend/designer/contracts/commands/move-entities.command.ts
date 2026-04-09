import type { EntityId } from "../ids";

export interface MoveEntitiesCommand {
  type: "move_entities";
  entityIds: EntityId[];
  deltaXNm: number;
  deltaYNm: number;
}
