import type { CommandId, DesignId, EntityId } from "./ids";
import type { Revision } from "./revision";

export interface DesignInvalidatedEvent {
  type: "design.invalidated";
  designId: DesignId;
  revision: Revision;
  sourceCommandId?: CommandId;
  affectedEntityIds: EntityId[];
  invalidated: Array<"schematic" | "nets">;
}
