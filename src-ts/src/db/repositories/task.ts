/**
 * Task Repository - Kernel Task Persistence
 *
 * Enhanced for AI Task Management System with support for:
 * - New task states (queued, waiting, paused)
 * - Task types (message, load, embedding)
 * - Task dependencies
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { task, type Task, type NewTask, type TaskStatus, type TaskType } from "../schema/task";
import { BaseRepository } from "./base";
import { eq, and, inArray, desc, sql, asc, isNotNull } from "drizzle-orm";
import { parseSQLiteError } from "../errors";
import { now } from "../../core/utils/time";
import { TaskStatus as TaskStatusEnum, TaskType as TaskTypeEnum } from "../../kernel/tasks/types";

export class TaskRepository extends BaseRepository<
  typeof task,
  Task,
  NewTask
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, task, logger, "Task");
  }

  /**
   * Find tasks by status (supports array)
   */
  async findByStatus(
    status: TaskStatus | TaskStatus[] | TaskStatusEnum | TaskStatusEnum[],
    limit?: number
  ): Promise<Task[]> {
    const start = performance.now();
    try {
      // Normalize status to string array
      const statusValues: TaskStatus[] = Array.isArray(status)
        ? status.map(s => s as TaskStatus)
        : [status as TaskStatus];

      let query = this.db
        .select()
        .from(task)
        .where(inArray(task.status, statusValues))
        .orderBy(desc(task.createdAt));

      if (limit) {
        query = query.limit(limit) as any;
      }

      const result = await query;
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByStatus", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByStatus [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findByStatus");
    }
  }

  /**
   * Find tasks by type
   */
  async findByType(type: TaskType | TaskTypeEnum, limit?: number): Promise<Task[]> {
    const start = performance.now();
    try {
      let query = this.db
        .select()
        .from(task)
        .where(eq(task.type, type as TaskType))
        .orderBy(desc(task.createdAt));

      if (limit) {
        query = query.limit(limit) as any;
      }

      const result = await query;
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByType", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByType [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findByType");
    }
  }

  /**
   * Find tasks by type and status
   */
  async findByTypeAndStatus(
    type: TaskType | TaskTypeEnum,
    status: TaskStatus | TaskStatus[] | TaskStatusEnum | TaskStatusEnum[],
    limit?: number
  ): Promise<Task[]> {
    const start = performance.now();
    try {
      // Normalize status to string array
      const statusValues: TaskStatus[] = Array.isArray(status)
        ? status.map(s => s as TaskStatus)
        : [status as TaskStatus];

      let query = this.db
        .select()
        .from(task)
        .where(
          and(
            eq(task.type, type as TaskType),
            inArray(task.status, statusValues)
          )
        )
        .orderBy(desc(task.createdAt));

      if (limit) {
        query = query.limit(limit) as any;
      }

      const result = await query;
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByTypeAndStatus", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByTypeAndStatus [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findByTypeAndStatus");
    }
  }

  /**
   * Find running/active tasks (backward compatibility)
   */
  async findRunning(): Promise<Task[]> {
    return this.findByStatus([
      TaskStatusEnum.PENDING,
      TaskStatusEnum.QUEUED,
      TaskStatusEnum.WAITING,
      TaskStatusEnum.RUNNING,
      TaskStatusEnum.STREAMING,
      TaskStatusEnum.PAUSED,
    ]);
  }

  /**
   * Find tasks waiting for a specific parent task (dependency resolution)
   */
  async findWaitingOn(parentTaskId: string): Promise<Task[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(task)
        .where(
          and(
            eq(task.dependsOn, parentTaskId),
            eq(task.status, 'waiting' as TaskStatus)
          )
        )
        .orderBy(desc(task.priority));

      const duration = performance.now() - start;
      this.logger.logQuery("Task.findWaitingOn", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findWaitingOn [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findWaitingOn");
    }
  }

  /**
   * Find existing LoadTask for provider:model (for deduplication)
   */
  async findLoadTask(provider: string, model: string): Promise<Task | undefined> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(task)
        .where(
          and(
            eq(task.type, 'load' as TaskType),
            eq(task.provider, provider),
            eq(task.model, model),
            inArray(task.status, ['queued', 'running', 'streaming'] as TaskStatus[])
          )
        )
        .limit(1);

      const duration = performance.now() - start;
      this.logger.logQuery("Task.findLoadTask", duration);
      return result[0];
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findLoadTask [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findLoadTask");
    }
  }

  /**
   * Find tasks by provider and status (for queue processing)
   */
  async findByProviderAndStatus(
    provider: string,
    status: TaskStatus | TaskStatus[],
    limit?: number
  ): Promise<Task[]> {
    const start = performance.now();
    try {
      const statusValues: TaskStatus[] = Array.isArray(status)
        ? status
        : [status];

      let query = this.db
        .select()
        .from(task)
        .where(
          and(
            eq(task.provider, provider),
            inArray(task.status, statusValues)
          )
        )
        .orderBy(desc(task.priority), task.createdAt);

      if (limit) {
        query = query.limit(limit) as any;
      }

      const result = await query;
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByProviderAndStatus", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByProviderAndStatus [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findByProviderAndStatus");
    }
  }

  /**
   * Find tasks by workspace
   */
  async findByWorkspace(workspaceId: string): Promise<Task[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(task)
        .where(eq(task.workspaceId, workspaceId))
        .orderBy(desc(task.createdAt));

      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByWorkspace", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByWorkspace [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findByWorkspace");
    }
  }

  /**
   * Find tasks for a specific chat in chronological order
   */
  async findByChat(chatId: string): Promise<Task[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(task)
        .where(eq(task.chatId, chatId))
        .orderBy(asc(task.createdAt));

      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByChat", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByChat [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findByChat");
    }
  }

  /**
   * Find message tasks grouped by assistant message IDs
   */
  async findByAssistantMessageIds(assistantMessageIds: string[]): Promise<Task[]> {
    if (assistantMessageIds.length === 0) {
      return [];
    }

    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(task)
        .where(
          and(
            eq(task.type, "message"),
            isNotNull(task.assistantMessageId),
            inArray(task.assistantMessageId, assistantMessageIds),
          ),
        )
        .orderBy(asc(task.createdAt));

      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByAssistantMessageIds", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findByAssistantMessageIds [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findByAssistantMessageIds");
    }
  }

  /**
   * Update waiting tasks array (append task ID)
   */
  async addWaitingTask(taskId: string, waitingTaskId: string): Promise<void> {
    const start = performance.now();
    try {
      const existing = await this.findByIdOrThrow(taskId);
      const waitingTasks = (existing.waitingTasks || []) as string[];
      if (!waitingTasks.includes(waitingTaskId)) {
        waitingTasks.push(waitingTaskId);
        await this.update(taskId, { waitingTasks });
      }

      const duration = performance.now() - start;
      this.logger.logQuery("Task.addWaitingTask", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.addWaitingTask [FAILED]", duration);
      throw parseSQLiteError(err, "Task.addWaitingTask");
    }
  }

  /**
   * Find all tasks with optional limit
   */
  async findAll(limit?: number): Promise<Task[]> {
    const start = performance.now();
    try {
      let query = this.db
        .select()
        .from(task)
        .orderBy(desc(task.createdAt));

      if (limit) {
        query = query.limit(limit) as any;
      }

      const result = await query;
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findAll", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.findAll [FAILED]", duration);
      throw parseSQLiteError(err, "Task.findAll");
    }
  }

  /**
   * Cleanup old completed tasks
   */
  async cleanupOld(maxAge: number): Promise<number> {
    const start = performance.now();
    try {
      const cutoff = now() - maxAge;
      const terminalStatuses: TaskStatus[] = ['completed', 'failed', 'cancelled'];

      const result = await this.db.delete(task).where(
        and(
          inArray(task.status, terminalStatuses),
          sql`${task.updatedAt} < ${cutoff}`
        )
      ).returning();

      const duration = performance.now() - start;
      this.logger.logQuery(`Task.cleanupOld (${result.length} deleted)`, duration);
      return result.length;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Task.cleanupOld [FAILED]", duration);
      throw parseSQLiteError(err, "Task.cleanupOld");
    }
  }
}
