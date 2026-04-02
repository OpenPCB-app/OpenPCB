import type { DatabaseAccess } from "../../../db";
import type { Task as DbTask } from "../../../db/schema/task";
import type { ChatTaskLock } from "../chat-task-lock";
import type { TaskSystem } from "../task-system";

interface LoadDependencyCoordinatorDependencies {
    db: DatabaseAccess;
    taskSystem: TaskSystem;
    chatTaskLock: ChatTaskLock;
    enqueueTask: (task: DbTask) => Promise<void>;
    enqueueTaskSync: (task: DbTask) => void;
    startMessageTaskIfReady: (
        task: DbTask,
        options?: { clearDependency?: boolean },
    ) => Promise<void>;
    startChatQueuedTaskIfReady: (chatId: string, taskId: string) => Promise<void>;
    log: (message: string) => void;
}

export class TaskLoadDependencyCoordinator {
    constructor(private readonly deps: LoadDependencyCoordinatorDependencies) {}

    async resolveLoadDependencies(loadTaskId: string): Promise<void> {
        const waitingTasks = await this.deps.db.tasks.findWaitingOn(loadTaskId);
        for (const waitingTask of waitingTasks) {
            if (waitingTask.type === "message") {
                await this.deps.startMessageTaskIfReady(waitingTask, {
                    clearDependency: true,
                });
                continue;
            }

            await this.deps.db.tasks.update(waitingTask.id, { dependsOn: null });
            await this.deps.enqueueTask({ ...waitingTask, dependsOn: null });
        }
    }

    async ensureLoadTaskQueued(loadTaskId: string): Promise<void> {
        const loadTask = await this.deps.db.tasks.findById(loadTaskId);
        if (!loadTask || loadTask.type !== "load") {
            return;
        }

        if (loadTask.status === "queued") {
            this.deps.enqueueTaskSync(loadTask);
            return;
        }

        if (loadTask.status === "pending") {
            await this.deps.enqueueTask(loadTask);
            return;
        }

        if (
            loadTask.status === "paused" &&
            (loadTask.retryCount ?? 0) < (loadTask.maxRetries ?? 3)
        ) {
            await this.deps.taskSystem.retryTask(loadTask.id);
            const updated = await this.deps.db.tasks.findById(loadTask.id);
            if (updated) {
                this.deps.enqueueTaskSync(updated);
            }
        }
    }

    async cancelLoadDependencies(loadTaskId: string): Promise<void> {
        const waitingTasks = await this.deps.db.tasks.findWaitingOn(loadTaskId);
        if (waitingTasks.length === 0) {
            return;
        }

        await this.deps.taskSystem.cascadeCancellation(
            waitingTasks.map((task) => task.id),
            "parent_failed",
        );

        const affectedChats = new Set<string>();
        for (const waitingTask of waitingTasks) {
            if (!waitingTask.chatId) continue;
            affectedChats.add(waitingTask.chatId);
            this.deps.chatTaskLock.cancel(waitingTask.chatId, waitingTask.id);
        }

        for (const chatId of affectedChats) {
            const activeTaskId = this.deps.chatTaskLock.getActive(chatId);
            if (activeTaskId) {
                await this.deps.startChatQueuedTaskIfReady(chatId, activeTaskId);
            }
        }
    }
}
