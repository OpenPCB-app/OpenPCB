import type { TaskEvent } from "../../../../sdks/tasks";

type Handler = (event: TaskEvent) => void;

export class TaskEventBus {
  private readonly globalHandlers = new Set<Handler>();
  private readonly taskHandlers = new Map<string, Set<Handler>>();

  on(handler: Handler): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  onTask(taskId: string, handler: Handler): () => void {
    const handlers = this.taskHandlers.get(taskId) ?? new Set<Handler>();
    handlers.add(handler);
    this.taskHandlers.set(taskId, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.taskHandlers.delete(taskId);
    };
  }

  emit(event: TaskEvent): void {
    for (const handler of this.globalHandlers) handler(event);
    for (const handler of this.taskHandlers.get(event.taskId) ?? []) handler(event);
  }
}
