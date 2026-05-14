import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type {
  CreateTaskInput,
  PersistedTaskEvent,
  Task,
  TaskChunk,
  TaskChunkInput,
  TaskEvent,
  TaskFilter,
  TaskStatus,
} from "../../../../sdks/tasks";

export interface TaskStorage {
  createTask<TPayload>(input: CreateTaskInput<TPayload> & { id?: string; status?: TaskStatus }): Promise<Task<TPayload>>;
  updateTask(id: string, patch: Partial<Task>): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  listTasks(filter?: TaskFilter): Promise<Task[]>;
  addWaitingTask(parentTaskId: string, waitingTaskId: string): Promise<Task>;
  removeWaitingTask(parentTaskId: string, waitingTaskId: string): Promise<Task>;
  findWaitingOn(taskId: string): Promise<Task[]>;
  findRunning(): Promise<Task[]>;
  appendChunks(taskId: string, chunks: TaskChunkInput[]): Promise<TaskChunk[]>;
  getChunks(taskId: string, fromSeq?: number): Promise<TaskChunk[]>;
  appendEvent(event: TaskEvent): Promise<PersistedTaskEvent>;
  listEvents(taskId: string): Promise<PersistedTaskEvent[]>;
}

interface ModuleDbWithRaw {
  rawSql<T = unknown>(query: string, params?: unknown[]): T[];
}

function rawSqlFrom(ctx: CoreBackendModuleContext): ModuleDbWithRaw["rawSql"] {
  return (ctx.db as ModuleDbWithRaw).rawSql.bind(ctx.db);
}

function id(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function encode(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function decode<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    type: String(row.type),
    status: row.status as TaskStatus,
    priority: Number(row.priority),
    queueKey: String(row.queue_key),
    dependsOn: row.depends_on ? String(row.depends_on) : null,
    waitingTasks: decode(String(row.waiting_tasks ?? "[]"), []),
    payload: decode(String(row.payload ?? "null"), null),
    result: decode(String(row.result ?? "null"), null),
    error: decode(String(row.error ?? "null"), null),
    retryCount: Number(row.retry_count),
    maxRetries: Number(row.max_retries),
    requestId: row.request_id ? String(row.request_id) : null,
    correlation: decode(String(row.correlation ?? "null"), null),
    tags: decode(String(row.tags ?? "[]"), []),
    metadata: decode(String(row.metadata ?? "null"), null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function rowToChunk(row: Record<string, unknown>): TaskChunk {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    seq: Number(row.seq),
    content: String(row.content),
    kind: row.kind as TaskChunk["kind"],
    metadata: decode(String(row.metadata ?? "null"), null),
    createdAt: String(row.created_at),
  };
}

export class OpenPcbTaskStorage implements TaskStorage {
  private readonly rawSql: ModuleDbWithRaw["rawSql"];

  constructor(ctx: CoreBackendModuleContext) {
    this.rawSql = rawSqlFrom(ctx);
  }

  async createTask<TPayload>(input: CreateTaskInput<TPayload> & { id?: string; status?: TaskStatus }): Promise<Task<TPayload>> {
    const timestamp = now();
    const taskId = input.id ?? id();
    this.rawSql(
      "INSERT INTO tasks_task (id,type,status,priority,queue_key,depends_on,waiting_tasks,payload,result,error,retry_count,max_retries,request_id,correlation,tags,metadata,created_at,updated_at,started_at,completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [taskId, input.type, input.status ?? "pending", input.priority ?? 5, input.queueKey ?? "default", input.dependsOn ?? null, "[]", encode(input.payload), null, null, 0, input.maxRetries ?? 3, input.requestId ?? null, encode(input.correlation ?? null), encode(input.tags ?? []), encode(input.metadata ?? null), timestamp, timestamp, null, null],
    );
    const created = await this.getTask(taskId);
    if (!created) {
      throw new Error(`Task insert failed: task ${taskId} not found after insert`);
    }
    return created as Task<TPayload>;
  }

  async updateTask(idValue: string, patch: Partial<Task>): Promise<Task> {
    const current = await this.required(idValue);
    const next = { ...current, ...patch, updatedAt: now() };
    this.rawSql(
      "UPDATE tasks_task SET status=?, priority=?, depends_on=?, waiting_tasks=?, result=?, error=?, retry_count=?, max_retries=?, request_id=?, correlation=?, tags=?, metadata=?, updated_at=?, started_at=?, completed_at=? WHERE id=?",
      [next.status, next.priority, next.dependsOn, encode(next.waitingTasks), encode(next.result), encode(next.error), next.retryCount, next.maxRetries, next.requestId, encode(next.correlation), encode(next.tags), encode(next.metadata), next.updatedAt, next.startedAt, next.completedAt, idValue],
    );
    return this.required(idValue);
  }

  async getTask(idValue: string): Promise<Task | null> {
    const row = this.rawSql<Record<string, unknown>>("SELECT * FROM tasks_task WHERE id=?", [idValue])[0];
    return row ? rowToTask(row) : null;
  }

  async listTasks(filter: TaskFilter = {}): Promise<Task[]> {
    const rows = this.rawSql<Record<string, unknown>>("SELECT * FROM tasks_task ORDER BY created_at DESC");
    let tasks = rows.map(rowToTask);
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter((task) => statuses.includes(task.status));
    }
    if (filter.type) tasks = tasks.filter((task) => task.type === filter.type);
    if (filter.queueKey) tasks = tasks.filter((task) => task.queueKey === filter.queueKey);
    if (filter.scopeId) tasks = tasks.filter((task) => task.correlation?.scopeId === filter.scopeId);
    if (filter.dependsOn) tasks = tasks.filter((task) => task.dependsOn === filter.dependsOn);
    return tasks.slice(0, filter.limit ?? 100);
  }

  async addWaitingTask(parentTaskId: string, waitingTaskId: string): Promise<Task> {
    const task = await this.required(parentTaskId);
    const waitingTasks = task.waitingTasks.includes(waitingTaskId) ? task.waitingTasks : [...task.waitingTasks, waitingTaskId];
    return this.updateTask(parentTaskId, { waitingTasks });
  }

  async removeWaitingTask(parentTaskId: string, waitingTaskId: string): Promise<Task> {
    const task = await this.required(parentTaskId);
    return this.updateTask(parentTaskId, { waitingTasks: task.waitingTasks.filter((entry) => entry !== waitingTaskId) });
  }

  findWaitingOn(taskId: string): Promise<Task[]> {
    return this.listTasks({ dependsOn: taskId, status: "waiting" });
  }

  findRunning(): Promise<Task[]> {
    return this.listTasks({ status: ["running", "streaming"] });
  }

  async appendChunks(taskId: string, chunks: TaskChunkInput[]): Promise<TaskChunk[]> {
    const maxRow = this.rawSql<{ maxSeq: number | null }>("SELECT MAX(seq) AS maxSeq FROM tasks_task_chunk WHERE task_id=?", [taskId])[0];
    let seq = (maxRow?.maxSeq ?? -1) + 1;
    const created = chunks.map((chunk) => ({
      id: id(),
      taskId,
      seq: chunk.seq ?? seq++,
      content: chunk.content,
      kind: chunk.kind ?? "text",
      metadata: chunk.metadata ?? null,
      createdAt: now(),
    } satisfies TaskChunk));
    for (const chunk of created) {
      this.rawSql("INSERT INTO tasks_task_chunk (id,task_id,seq,content,kind,metadata,created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [chunk.id, chunk.taskId, chunk.seq, chunk.content, chunk.kind, encode(chunk.metadata), chunk.createdAt]);
    }
    return created;
  }

  async getChunks(taskId: string, fromSeq = 0): Promise<TaskChunk[]> {
    return this.rawSql<Record<string, unknown>>("SELECT * FROM tasks_task_chunk WHERE task_id=? AND seq >= ? ORDER BY seq ASC", [taskId, fromSeq]).map(rowToChunk);
  }

  async appendEvent(event: TaskEvent): Promise<PersistedTaskEvent> {
    const persisted = { ...event, id: id() };
    try {
      this.rawSql(
        "INSERT INTO tasks_task_event (id,task_id,type,status,data,timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        [persisted.id, persisted.taskId, persisted.type, persisted.status ?? null, encode(persisted.data), persisted.timestamp],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("FOREIGN KEY")) {
        console.warn(`[tasks] Event persistence skipped: task ${persisted.taskId} not yet visible`, { event: persisted });
      } else {
        throw error;
      }
    }
    return persisted;
  }

  async listEvents(taskId: string): Promise<PersistedTaskEvent[]> {
    return this.rawSql<Record<string, unknown>>("SELECT * FROM tasks_task_event WHERE task_id=? ORDER BY timestamp ASC", [taskId]).map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      type: row.type as PersistedTaskEvent["type"],
      ...(row.status ? { status: row.status as TaskStatus } : {}),
      data: decode(String(row.data ?? "null"), undefined),
      timestamp: String(row.timestamp),
    }));
  }

  private async required(taskId: string): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }
}
