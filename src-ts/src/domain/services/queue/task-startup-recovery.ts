import type { DatabaseAccess } from "../../../db";
import type { Task as DbTask, TaskMetadata } from "../../../db/schema/task";
import type { ChatTaskLock } from "../chat-task-lock";
import type { TaskSystem } from "../task-system";
import type { TaskQueueManager } from "./task-queue-manager";

interface StartupRecoveryDependencies {
    db: DatabaseAccess;
    taskSystem: TaskSystem;
    queueManager: TaskQueueManager;
    chatTaskLock: ChatTaskLock;
    ensureChatTaskQueued: (chatId: string, taskId: string) => void;
    startChatQueuedTask: (chatId: string, taskId: string) => Promise<void>;
    enqueueTask: (task: DbTask) => Promise<void>;
    log: (message: string) => void;
}

export class TaskStartupRecovery {
    constructor(private readonly deps: StartupRecoveryDependencies) {}

    async resumeTasksOnStartup(): Promise<void> {
        const {
            db,
            taskSystem,
            queueManager,
            chatTaskLock,
            ensureChatTaskQueued,
            startChatQueuedTask,
            enqueueTask,
            log,
        } = this.deps;

        await taskSystem.resumeTasksOnStartup();

        const messageTasks = await db.tasks.findByTypeAndStatus("message", [
            "pending",
            "waiting",
            "queued",
            "paused",
        ]);

        const sortedMessageTasks = [...messageTasks].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );

        for (const task of sortedMessageTasks) {
            if (task.chatId) {
                ensureChatTaskQueued(task.chatId, task.id);
            }
        }

        for (const task of sortedMessageTasks) {
            if (!task.chatId) continue;

            const activeTaskId = chatTaskLock.getActive(task.chatId);
            if (activeTaskId !== task.id) {
                const waitReason = task.dependsOn ? "model_loading" : "chat_serialized";
                const currentWaitReason = (task.metadata as TaskMetadata | null)?.waitReason;
                if (task.status !== "waiting" || currentWaitReason !== waitReason) {
                    await db.tasks.update(task.id, {
                        status: "waiting",
                        metadata: {
                            ...((task.metadata as Record<string, unknown>) ?? {}),
                            waitReason,
                        },
                    });
                }
                continue;
            }

            if (task.dependsOn) {
                await db.tasks.update(task.id, {
                    status: "waiting",
                    metadata: {
                        ...((task.metadata as Record<string, unknown>) ?? {}),
                        waitReason: "model_loading",
                    },
                });
                continue;
            }

            await startChatQueuedTask(task.chatId, task.id);
        }

        const queuedTasks = await db.tasks.findByStatus(["queued"]);
        for (const task of queuedTasks) {
            if (task.type === "message") continue;
            queueManager.enqueue(task);
        }

        const pausedTasks = await db.tasks.findByStatus(["paused"]);
        for (const task of pausedTasks) {
            if (task.type === "message") continue;
            if ((task.retryCount ?? 0) < (task.maxRetries ?? 3)) {
                if (task.dependsOn) {
                    const dep = await db.tasks.findById(task.dependsOn);
                    if (dep && dep.status !== "completed") {
                        log(
                            `Skipping paused task ${task.id} - dependency ${task.dependsOn} not resolved`,
                        );
                        continue;
                    }
                }
                await enqueueTask({ ...task, status: "queued" });
            }
        }

        await queueManager.processAllQueues();
        log("Startup recovery complete");
    }
}
