import type { CommandId } from "../../contracts/ids";

export interface SessionHistory {
  undoStack: CommandId[];
  redoStack: CommandId[];
}
