import type { TasksSDK } from "../../../sdks/tasks";
import { getTaskRuntime } from "./runtime-singleton";

export function buildTasksSdk(): TasksSDK {
  const runtime = getTaskRuntime();
  return {
    createTask: (input) => runtime.createTask(input),
    getTask: (taskId) => runtime.getTask(taskId),
    listTasks: (filter) => runtime.listTasks(filter),
    cancelTask: (taskId) => runtime.cancelTask(taskId),
    retryTask: (taskId) => runtime.retryTask(taskId),
    getChunks: (taskId, fromSeq) => runtime.storage.getChunks(taskId, fromSeq),
    getEvents: (taskId) => runtime.storage.listEvents(taskId),
    getQueueStatus: () => runtime.getQueueStatus(),
    registerExecutor: (type, executor) => runtime.registerExecutor(type, executor),
    onEvent: (handler) => runtime.onEvent(handler),
    onTaskEvent: (taskId, handler) => runtime.onTaskEvent(taskId, handler),
  };
}
