import { CommandHistory } from "../../../shared/domain/commands";
import type {
  DesignerCommand,
  DesignerHistoryActionResult,
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
  return {
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    undoDepth: snapshot.undoDepth,
    redoDepth: snapshot.redoDepth,
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
