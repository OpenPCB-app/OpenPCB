import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import { AGENTKIT_MONITOR_TOKEN, type TasksSDK } from "../../../sdks/tasks";

export function buildTasksSdk(context: CoreBackendModuleContext): TasksSDK {
  const monitor = (): TasksSDK => {
    const value = context.sdk.get<TasksSDK>(AGENTKIT_MONITOR_TOKEN);
    if (!value) throw new Error("AgentKit run monitor is unavailable");
    return value;
  };
  return {
    listTasks: (input) => monitor().listTasks(input),
    getTask: (id) => monitor().getTask(id),
    cancelTask: (id) => monitor().cancelTask(id),
    resumeTask: (id) => monitor().resumeTask(id),
  };
}
