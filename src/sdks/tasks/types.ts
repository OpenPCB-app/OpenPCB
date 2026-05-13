export type TaskStatus =
  | "pending"
  | "queued"
  | "waiting"
  | "running"
  | "streaming"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskCorrelation {
  scopeId?: string;
  custom?: Record<string, unknown>;
}

export interface TaskError {
  type: "transient" | "fatal" | "provider" | "validation" | "cancelled";
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
  timestamp: string;
  stack?: string;
}

export interface TaskResult<TResult = unknown> {
  success: boolean;
  data: TResult;
  duration: number;
  finishReason?: "stop" | "length" | "error" | "cancelled";
  warnings?: string[];
  usage?: Record<string, number>;
}

export interface Task<TPayload = unknown, TResult = unknown> {
  id: string;
  type: string;
  status: TaskStatus;
  priority: number;
  queueKey: string;
  dependsOn: string | null;
  waitingTasks: string[];
  payload: TPayload;
  result: TaskResult<TResult> | null;
  error: TaskError | null;
  retryCount: number;
  maxRetries: number;
  requestId: string | null;
  correlation: TaskCorrelation | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CreateTaskInput<TPayload = unknown> {
  type: string;
  queueKey?: string;
  priority?: number;
  payload: TPayload;
  dependsOn?: string | null;
  correlation?: TaskCorrelation | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
  requestId?: string | null;
  maxRetries?: number;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  type?: string;
  queueKey?: string;
  scopeId?: string;
  dependsOn?: string;
  limit?: number;
}

export interface TaskChunk {
  id: string;
  taskId: string;
  seq: number;
  content: string;
  kind: "text" | "log" | "json" | "binary-ref";
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type TaskEventType =
  | "task.created"
  | "task.queued"
  | "task.started"
  | "task.streaming"
  | "task.progress"
  | "task.chunk"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "task.paused";

export interface TaskEvent<TData = unknown> {
  id?: string;
  type: TaskEventType;
  taskId: string;
  status?: TaskStatus;
  data?: TData;
  timestamp: string;
}

export interface PersistedTaskEvent extends TaskEvent {
  id: string;
}

export interface QueueStatus {
  queueKey: string;
  queuedTasks: number;
  activeTasks: number;
  availableSlots: number;
  maxConcurrent: number;
}

export interface CreateTaskResult<TPayload = unknown> {
  task: Task<TPayload>;
  enqueuedImmediately: boolean;
  queueStatus: QueueStatus;
}

export interface TaskProgress {
  progress?: number;
  stage?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskChunkInput {
  seq?: number;
  content: string;
  kind?: TaskChunk["kind"];
  metadata?: Record<string, unknown>;
}

export interface TaskExecutionContext<TPayload = unknown> {
  task: Task<TPayload>;
  signal: AbortSignal;
  emitProgress(progress: TaskProgress): Promise<void>;
  emitChunk(chunk: TaskChunkInput): Promise<void>;
  emitEvent(event: Omit<TaskEvent, "taskId" | "timestamp">): Promise<void>;
  logger: { info(message: string, meta?: unknown): void; error(message: string, meta?: unknown): void };
}

export interface TaskExecutor<TPayload = unknown, TResult = unknown> {
  execute(ctx: TaskExecutionContext<TPayload>): Promise<TResult>;
}

export interface TasksSDK {
  createTask<TPayload = unknown>(input: CreateTaskInput<TPayload>): Promise<CreateTaskResult<TPayload>>;
  getTask(taskId: string): Promise<Task>;
  listTasks(filter?: TaskFilter): Promise<Task[]>;
  cancelTask(taskId: string): Promise<void>;
  retryTask(taskId: string): Promise<void>;
  getChunks(taskId: string, fromSeq?: number): Promise<TaskChunk[]>;
  getEvents(taskId: string): Promise<PersistedTaskEvent[]>;
  getQueueStatus(): QueueStatus[];
  registerExecutor(type: string, executor: TaskExecutor): void;
  onEvent(handler: (event: TaskEvent) => void): () => void;
  onTaskEvent(taskId: string, handler: (event: TaskEvent) => void): () => void;
}
