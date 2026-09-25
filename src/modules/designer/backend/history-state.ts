import { CommandHistory } from "../../../shared/domain/commands";
import type {
  DesignerCommand,
  DesignerHistoryActionResult,
  DesignerHistoryEntryRef,
  DesignerHistorySnapshot,
} from "../../../sdks";
import type { DesignerWorldComponent } from "./projection-world";

export function historySessionKey(designId: string, sessionId: string): string {
  return `${designId}:${sessionId}`;
}

export function summarizeHistory(
  history: CommandHistory<DesignerCommand, DesignerWorldComponent>,
): DesignerHistorySnapshot {
  const snapshot = history.snapshot();
  const top = (
    stack: typeof snapshot.undoStack,
  ): DesignerHistoryEntryRef | null => {
    const entry = stack[stack.length - 1];
    return entry
      ? {
          commandId: entry.envelope.commandId,
          commandType: entry.envelope.command.type,
          revision: entry.revision,
        }
      : null;
  };
  return {
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    undoDepth: snapshot.undoDepth,
    redoDepth: snapshot.redoDepth,
    nextUndo: top(snapshot.undoStack),
    nextRedo: top(snapshot.redoStack),
  };
}

export function emptyHistorySnapshot(): DesignerHistorySnapshot {
  return { canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 };
}

export function historyEmpty(
  direction: "undo" | "redo",
  history: DesignerHistorySnapshot,
): DesignerHistoryActionResult {
  return { ok: false, code: "HISTORY_EMPTY", direction, history };
}
