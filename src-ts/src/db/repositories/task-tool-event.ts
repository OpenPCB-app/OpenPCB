import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import {
  taskToolEvent,
  type TaskToolEvent,
  type NewTaskToolEvent,
  type TaskToolEventKind,
} from "../schema/task-tool-event";
import { BaseRepository } from "./base";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { parseSQLiteError } from "../errors";

interface AppendToolCallInput {
  chatId: string;
  assistantMessageId: string;
  taskId: string;
  toolCallId: string;
  toolName: string;
  args?: unknown;
  seq?: number;
}

interface AppendToolResultInput {
  chatId: string;
  assistantMessageId: string;
  taskId: string;
  toolCallId: string;
  toolName: string;
  result?: unknown;
  isError?: boolean;
  seq?: number;
}

export class TaskToolEventRepository extends BaseRepository<
  typeof taskToolEvent,
  TaskToolEvent,
  NewTaskToolEvent
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, taskToolEvent, logger, "TaskToolEvent");
  }

  async appendToolCall(input: AppendToolCallInput): Promise<TaskToolEvent> {
    return this.append({
      ...input,
      kind: "tool-call",
      args: input.args,
    });
  }

  async appendToolResult(input: AppendToolResultInput): Promise<TaskToolEvent> {
    return this.append({
      ...input,
      kind: "tool-result",
      result: input.result,
      isError: input.isError,
    });
  }

  async listByAssistantMessageIds(assistantMessageIds: string[]): Promise<TaskToolEvent[]> {
    if (assistantMessageIds.length === 0) {
      return [];
    }

    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(taskToolEvent)
        .where(inArray(taskToolEvent.assistantMessageId, assistantMessageIds))
        .orderBy(
          asc(taskToolEvent.assistantMessageId),
          asc(taskToolEvent.seq),
          asc(taskToolEvent.createdAt),
        );

      const duration = performance.now() - start;
      this.logger.logQuery("TaskToolEvent.listByAssistantMessageIds", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("TaskToolEvent.listByAssistantMessageIds [FAILED]", duration);
      throw parseSQLiteError(err, "TaskToolEvent.listByAssistantMessageIds");
    }
  }

  async listByAssistantMessageId(assistantMessageId: string): Promise<TaskToolEvent[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(taskToolEvent)
        .where(eq(taskToolEvent.assistantMessageId, assistantMessageId))
        .orderBy(asc(taskToolEvent.seq), asc(taskToolEvent.createdAt));

      const duration = performance.now() - start;
      this.logger.logQuery("TaskToolEvent.listByAssistantMessageId", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("TaskToolEvent.listByAssistantMessageId [FAILED]", duration);
      throw parseSQLiteError(err, "TaskToolEvent.listByAssistantMessageId");
    }
  }

  private async append(params: {
    chatId: string;
    assistantMessageId: string;
    taskId: string;
    seq?: number;
    kind: TaskToolEventKind;
    toolCallId: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean;
  }): Promise<TaskToolEvent> {
    const start = performance.now();
    try {
      const resolvedSeq =
        typeof params.seq === "number"
          ? params.seq
          : await this.nextSeq(params.assistantMessageId, params.toolCallId);

      return await this.create({
        chatId: params.chatId,
        assistantMessageId: params.assistantMessageId,
        taskId: params.taskId,
        seq: resolvedSeq,
        kind: params.kind,
        toolCallId: params.toolCallId,
        toolName: params.toolName,
        args: params.args,
        result: params.result,
        isError: params.isError,
      });
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("TaskToolEvent.append [FAILED]", duration);
      throw parseSQLiteError(err, "TaskToolEvent.append");
    }
  }

  private async nextSeq(assistantMessageId: string, toolCallId: string): Promise<number> {
    const existingCall = await this.db
      .select({
        seq: taskToolEvent.seq,
      })
      .from(taskToolEvent)
      .where(
        and(
          eq(taskToolEvent.assistantMessageId, assistantMessageId),
          eq(taskToolEvent.toolCallId, toolCallId),
          eq(taskToolEvent.kind, "tool-call"),
        ),
      )
      .orderBy(desc(taskToolEvent.seq))
      .limit(1);

    if (existingCall.length > 0) {
      const base = existingCall[0]?.seq ?? 0;
      const paired = await this.db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(taskToolEvent)
        .where(
          and(
            eq(taskToolEvent.assistantMessageId, assistantMessageId),
            eq(taskToolEvent.toolCallId, toolCallId),
            eq(taskToolEvent.kind, "tool-result"),
          ),
        );
      const resultCount = paired[0]?.count ?? 0;
      return base + resultCount + 1;
    }

    const rows = await this.db
      .select({
        seq: sql<number>`coalesce(max(${taskToolEvent.seq}), -1)`,
      })
      .from(taskToolEvent)
      .where(eq(taskToolEvent.assistantMessageId, assistantMessageId));
    const maxSeq = rows[0]?.seq ?? -1;
    return maxSeq + 1;
  }
}
