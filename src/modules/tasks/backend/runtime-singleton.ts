import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import { TaskRuntime } from "./runtime";
import { OpenPcbTaskStorage } from "./storage/openpcb-task-storage";

let runtime: TaskRuntime | null = null;

export async function initializeTaskRuntime(ctx: CoreBackendModuleContext): Promise<TaskRuntime> {
  if (runtime) return runtime;
  runtime = new TaskRuntime(new OpenPcbTaskStorage(ctx), ctx.logger);
  runtime.registerExecutor("tasks.echo", {
    async execute(taskCtx) {
      const payload = taskCtx.task.payload as { message?: string; delayMs?: number };
      if (payload.delayMs && payload.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, payload.delayMs));
      }
      const message = payload.message ?? "ok";
      await taskCtx.emitChunk({ content: message, kind: "text" });
      return { message };
    },
  });
  await runtime.resumeTasksOnStartup();
  return runtime;
}

export function getTaskRuntime(): TaskRuntime {
  if (!runtime) throw new Error("Task runtime not initialized");
  return runtime;
}
