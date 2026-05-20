import type { TasksSDK } from "../../../sdks/tasks";
import { getTaskRuntime } from "./runtime-singleton";

export function buildTasksSdk(): TasksSDK {
  return {
    createTask: (input) => getTaskRuntime().createTask(input),
    getTask: (taskId) => getTaskRuntime().getTask(taskId),
    listTasks: (filter) => getTaskRuntime().listTasks(filter),
    cancelTask: (taskId) => getTaskRuntime().cancelTask(taskId),
    retryTask: (taskId) => getTaskRuntime().retryTask(taskId),
    getChunks: (taskId, fromSeq) => getTaskRuntime().storage.getChunks(taskId, fromSeq),
    getEvents: (taskId) => getTaskRuntime().storage.listEvents(taskId),
    getQueueStatus: () => getTaskRuntime().getQueueStatus(),
    registerExecutor: (type, executor) => getTaskRuntime().registerExecutor(type, executor),
    onEvent: (handler) => getTaskRuntime().onEvent(handler),
    onTaskEvent: (taskId, handler) => getTaskRuntime().onTaskEvent(taskId, handler),
  };
}
