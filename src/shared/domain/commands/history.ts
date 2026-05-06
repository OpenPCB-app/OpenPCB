import type { AnyEcsComponent } from "../ecs/component";
import type { Revision } from "../revision/revision";
import type { CommandEnvelope } from "./command-envelope";
import type { EcsPatch } from "./patch";

export interface CommandHistoryEntry<
  TCommand = unknown,
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> {
  envelope: CommandEnvelope<TCommand>;
  revision: Revision;
  forwardPatches: EcsPatch<TComponent>[];
  inversePatches: EcsPatch<TComponent>[];
  createdEntityId: string | null;
  timestamp: number;
}

export interface CommandHistorySnapshot<
  TCommand = unknown,
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> {
  undoDepth: number;
  redoDepth: number;
  undoStack: ReadonlyArray<CommandHistoryEntry<TCommand, TComponent>>;
  redoStack: ReadonlyArray<CommandHistoryEntry<TCommand, TComponent>>;
}

export class CommandHistory<
  TCommand = unknown,
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> {
  private readonly undoStack: CommandHistoryEntry<TCommand, TComponent>[] = [];
  private readonly redoStack: CommandHistoryEntry<TCommand, TComponent>[] = [];

  constructor(private readonly maxDepth = 200) {}

  record(entry: CommandHistoryEntry<TCommand, TComponent>): void {
    this.undoStack.push(entry);
    this.redoStack.length = 0;
    this.trimUndoStack();
  }

  consumeUndo(): CommandHistoryEntry<TCommand, TComponent> | null {
    const entry = this.undoStack.pop();
    if (!entry) {
      return null;
    }
    this.redoStack.push(entry);
    return entry;
  }

  consumeRedo(): CommandHistoryEntry<TCommand, TComponent> | null {
    const entry = this.redoStack.pop();
    if (!entry) {
      return null;
    }
    this.undoStack.push(entry);
    return entry;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  restore(snapshot: CommandHistorySnapshot<TCommand, TComponent>): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.undoStack.push(...snapshot.undoStack);
    this.redoStack.push(...snapshot.redoStack);
    this.trimUndoStack();
  }

  snapshot(): CommandHistorySnapshot<TCommand, TComponent> {
    return {
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      undoStack: [...this.undoStack],
      redoStack: [...this.redoStack],
    };
  }

  private trimUndoStack(): void {
    const overflow = this.undoStack.length - this.maxDepth;
    if (overflow > 0) {
      this.undoStack.splice(0, overflow);
    }
  }
}
