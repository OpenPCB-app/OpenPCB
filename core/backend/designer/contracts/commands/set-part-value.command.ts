import type { EntityId } from "../ids";

export interface SetPartValueCommand {
  type: "set_part_value";
  partInstanceId: EntityId;
  value: string;
}
