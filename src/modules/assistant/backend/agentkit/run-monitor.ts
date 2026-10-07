import type { NodeSqliteAssistantStore } from "agentkit/adapters-sqlite-node";
import type { TaskRecord } from "agentkit/host";
import type { SingleProcessTaskRunner } from "agentkit/runner-local";
import type { TasksSDK, TaskRunPageInput, TaskRunSummary } from "../../../../sdks/tasks";
import { ValidationError } from "../../../../core/contracts/errors";

type MonitorStore = Pick<NodeSqliteAssistantStore, "database" | "tasks">;
interface Cursor { time: string; id: string; chatId: string | null }
interface TaskIdRow { task_id: string; enqueued_at: string }

function cursorFor(input: TaskRunPageInput): Cursor | null {
  if (input.cursor === undefined) return null;
  if (input.cursor.length > 1024) throw new ValidationError("Run cursor is invalid");
  try {
    const value: unknown = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || !("time" in value) || !("id" in value) || !("chatId" in value)
      || typeof value.time !== "string" || typeof value.id !== "string" || !value.id
      || !Number.isFinite(Date.parse(value.time)) || value.chatId !== (input.chatId ?? null)) {
      throw new Error("Invalid cursor");
    }
    return value as Cursor;
  } catch { throw new ValidationError("Run cursor is invalid"); }
}

function summarize(task: TaskRecord): TaskRunSummary {
  return { taskId: task.taskId, kind: task.kind, scopeId: task.scopeId, status: task.status,
    enqueuedAt: task.enqueuedAt, startedAt: task.startedAt, finishedAt: task.finishedAt,
    attemptCount: task.attemptCount, error: task.error,
    chatId: typeof task.payload.chatId === "string" ? task.payload.chatId : null };
}

/** Version-coupled read projection; all lifecycle writes remain canonical runner operations. */
export function createRunMonitor(
  store: MonitorStore, runner: Pick<SingleProcessTaskRunner, "requestCancel" | "resume">,
): TasksSDK {
  return {
    async listTasks(input = {}) {
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ValidationError("Run page limit must be 1 to 50");
      if (input.chatId !== undefined && (!input.chatId.trim() || input.chatId.length > 200)) {
        throw new ValidationError("Chat filter is invalid");
      }
      const cursor = cursorFor(input);
      const rows = store.database.query(`SELECT task_id, enqueued_at FROM tasks
        WHERE ($chatId IS NULL OR json_extract(payload, '$.chatId') = $chatId)
          AND ($time IS NULL OR enqueued_at < $time OR (enqueued_at = $time AND task_id < $id))
        ORDER BY enqueued_at DESC, task_id DESC LIMIT $limit`).all({
        $chatId: input.chatId ?? null, $time: cursor?.time ?? null, $id: cursor?.id ?? null, $limit: limit + 1,
      }) as TaskIdRow[];
      const page = rows.slice(0, limit);
      const tasks = await Promise.all(page.map((row) => store.tasks.getTask(row.task_id)));
      const last = page.at(-1);
      return { items: tasks.filter((task): task is TaskRecord => task !== null).map(summarize),
        nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({
          time: last.enqueued_at, id: last.task_id, chatId: input.chatId ?? null,
        } satisfies Cursor)).toString("base64url") : null };
    },
    async getTask(taskId) { const task = await store.tasks.getTask(taskId); return task ? summarize(task) : null; },
    async cancelTask(taskId) { await runner.requestCancel(taskId); },
    async resumeTask(taskId) { await runner.resume(taskId); },
  };
}
