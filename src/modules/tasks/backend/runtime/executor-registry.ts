import type { TaskExecutor } from "../../../../sdks/tasks";

export class ExecutorRegistry {
  private readonly executors = new Map<string, TaskExecutor>();

  register(type: string, executor: TaskExecutor): void {
    this.executors.set(type, executor);
  }

  get(type: string): TaskExecutor {
    const executor = this.executors.get(type);
    if (!executor) throw new Error(`No executor registered for task type '${type}'`);
    return executor;
  }
}
