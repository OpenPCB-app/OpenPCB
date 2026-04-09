import type { DesignId, SessionId, CommandId } from "../../contracts/ids";
import type { SessionHistory } from "./history-entry";

function key(designId: DesignId, sessionId: SessionId): string {
  return `${designId}:${sessionId}`;
}

export class UndoSessionRegistry {
  private sessions = new Map<string, SessionHistory>();

  private getSession(designId: DesignId, sessionId: SessionId): SessionHistory {
    const k = key(designId, sessionId);
    const existing = this.sessions.get(k);
    if (existing) {
      return existing;
    }
    const next: SessionHistory = { undoStack: [], redoStack: [] };
    this.sessions.set(k, next);
    return next;
  }

  pushUndo(designId: DesignId, sessionId: SessionId, commandId: CommandId): void {
    const session = this.getSession(designId, sessionId);
    session.undoStack.push(commandId);
    session.redoStack = [];
  }

  popUndo(designId: DesignId, sessionId: SessionId): CommandId | null {
    const session = this.getSession(designId, sessionId);
    return session.undoStack.pop() ?? null;
  }

  peekUndo(designId: DesignId, sessionId: SessionId): CommandId | null {
    const session = this.getSession(designId, sessionId);
    return session.undoStack[session.undoStack.length - 1] ?? null;
  }

  pushRedo(designId: DesignId, sessionId: SessionId, commandId: CommandId): void {
    const session = this.getSession(designId, sessionId);
    session.redoStack.push(commandId);
  }

  popRedo(designId: DesignId, sessionId: SessionId): CommandId | null {
    const session = this.getSession(designId, sessionId);
    return session.redoStack.pop() ?? null;
  }

  peekRedo(designId: DesignId, sessionId: SessionId): CommandId | null {
    const session = this.getSession(designId, sessionId);
    return session.redoStack[session.redoStack.length - 1] ?? null;
  }

  clearRedo(designId: DesignId, sessionId: SessionId): void {
    const session = this.getSession(designId, sessionId);
    session.redoStack = [];
  }
}
