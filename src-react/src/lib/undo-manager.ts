interface UndoEntry<T> {
  description: string;
  snapshot: T;
}

export interface UndoManager<T> {
  pushUndo(description: string, snapshot: T): void;
  undo(currentDocument: T): { restored: T; description: string } | null;
  redo(currentDocument: T): { restored: T; description: string } | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

const DEFAULT_MAX_SIZE = 50;

export function createUndoManager<T>(
  maxSize: number = DEFAULT_MAX_SIZE,
): UndoManager<T> {
  let undoStack: UndoEntry<T>[] = [];
  let redoStack: UndoEntry<T>[] = [];

  return {
    pushUndo(description: string, snapshot: T): void {
      const cloned = structuredClone(snapshot);
      undoStack.push({ description, snapshot: cloned });

      if (undoStack.length > maxSize) {
        undoStack = undoStack.slice(undoStack.length - maxSize);
      }

      redoStack = [];
    },

    undo(currentDocument: T): { restored: T; description: string } | null {
      if (undoStack.length === 0) {
        return null;
      }

      const entry = undoStack.pop()!;

      redoStack.push({
        description: entry.description,
        snapshot: structuredClone(currentDocument),
      });

      return {
        restored: entry.snapshot,
        description: entry.description,
      };
    },

    redo(currentDocument: T): { restored: T; description: string } | null {
      if (redoStack.length === 0) {
        return null;
      }

      const entry = redoStack.pop()!;

      undoStack.push({
        description: entry.description,
        snapshot: structuredClone(currentDocument),
      });

      return {
        restored: entry.snapshot,
        description: entry.description,
      };
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    clear(): void {
      undoStack = [];
      redoStack = [];
    },
  };
}
