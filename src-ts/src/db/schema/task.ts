/**
 * Task Schema - AI Task Management System
 *
 * Enhanced task persistence supporting:
 * - Task dependencies (LoadTask → MessageTask)
 * - Per-provider queuing with priority
 * - Retry logic with exponential backoff
 * - Partial result persistence
 *
 * See: TASK_SYSTEM_SPECIFICATION.md
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { workspace } from "./workspace";
import { project } from "./project";
import { chat } from "./chat";
import type { ToolDefinition } from "../../infrastructure/ai-providers/engine";
import type { ContentSelection, TargetRef } from "../../domain/services/content-editor/types";

/**
 * Task status lifecycle:
 * - pending: Created, not yet queued
 * - queued: In provider queue, waiting for slot
 * - waiting: Blocked by dependency (e.g., LoadTask)
 * - running: Actively executing
 * - streaming: Receiving token stream
 * - paused: Temporarily halted for retry
 * - completed: Successfully finished
 * - failed: Permanently failed
 * - cancelled: User cancelled
 */
export const TASK_STATUS = [
  "pending",
  "queued",
  "waiting",
  "running",
  "streaming",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUS)[number];

/**
 * Task types:
 * - message: Chat completion with conversation context
 * - load: Model loading for server/local providers
 * - embedding: Generate embeddings
 * - content_edit: AI-powered content editing
 * - chat: Legacy chat type (deprecated, use message)
 * - completion: Legacy completion type (deprecated)
 */
export const TASK_TYPES = ["message", "load", "embedding", "content_edit", "chat", "completion"] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const task = sqliteTable(
  "task",
  {
    ...uuidPrimaryKey,

    // Task identification
    type: text("type", { enum: TASK_TYPES }).notNull(),

    // Task lifecycle
    status: text("status", { enum: TASK_STATUS }).notNull().default("pending"),

    // Priority (0-10, higher = more urgent, default 5)
    priority: integer("priority").notNull().default(5),

    // Provider context (required for execution)
    provider: text("provider").notNull(),
    model: text("model").notNull(),

    // Task dependencies
    // FK to parent task (e.g., MessageTask depends on LoadTask)
    dependsOn: text("depends_on").references((): any => task.id, { onDelete: "set null" }),
    // JSON array of task IDs blocked by this task
    waitingTasks: text("waiting_tasks", { mode: "json" }).$type<string[]>().default([]),

    // Task data (stored as JSON)
    payload: text("payload", { mode: "json" }).notNull().$type<unknown>(),
    result: text("result", { mode: "json" }).$type<TaskResultData>(),
    resultRaw: text("result_raw", { mode: "json" }).$type<unknown>(), // Raw provider response

    // Legacy fields (for backward compatibility)
    input: text("input", { mode: "json" }).$type<unknown>(),
    output: text("output", { mode: "json" }).$type<unknown>(),
    error: text("error", { mode: "json" }).$type<TaskError>(),

    // Retry configuration
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),

    // Timestamps (kernel format)
    ...timestamps, // createdAt, updatedAt
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),

    // Task metadata (progress, errors, custom data)
    metadata: text("metadata", { mode: "json" }).$type<TaskMetadata>(),

    // Idempotency key for provider requests (crash recovery)
    requestId: text("request_id"),

    // Context linking (for OpenPCB features)
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    chatId: text("chat_id").references(() => chat.id, { onDelete: "set null" }),
    assistantMessageId: text("assistant_message_id"),
  },
  (table) => ({
    workspaceIdx: index("idx_task_workspace").on(table.workspaceId),
    projectIdx: index("idx_task_project").on(table.projectId),
    chatIdx: index("idx_task_chat").on(table.chatId),
    assistantMessageIdx: index("idx_task_assistant_message").on(table.assistantMessageId),
    statusIdx: index("idx_task_status").on(table.status),
    typeIdx: index("idx_task_type").on(table.type),
    typeStatusIdx: index("idx_task_type_status").on(table.type, table.status),
    providerModelIdx: index("idx_task_provider_model").on(table.provider, table.model),
    dependsOnIdx: index("idx_task_depends_on").on(table.dependsOn),
    priorityStatusIdx: index("idx_task_priority_status").on(table.priority, table.status),
    createdIdx: index("idx_task_created").on(table.createdAt),
  })
);

export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;

/**
 * Task error information
 */
export interface TaskError {
  type: "transient" | "fatal" | "provider" | "validation";
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
  timestamp: string;
  stack?: string;
}

/**
 * Task result data (standardized output)
 */
export interface TaskResultData {
  success: boolean;
  data: unknown;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
  duration: number; // milliseconds
  finishReason?: "stop" | "length" | "error" | "cancelled";
  warnings?: string[];
}

/**
 * Token chunk for streaming results
 */
export interface TokenChunk {
  sequence: number;
  content: string;
  timestamp: string;
}

/**
 * Message task result data
 */
export interface MessageTaskResultData extends TaskResultData {
  data: {
    content: string;
    role: "assistant";
    chunks: TokenChunk[];
    incomplete?: boolean;
  };
}

/**
 * Load task result data
 */
export interface LoadTaskResultData extends TaskResultData {
  data: {
    modelLoaded: boolean;
    loadDuration: number;
    modelSize?: string;
    progressStages?: string[];
  };
}

/**
 * Task metadata (progress, errors, custom data)
 */
export interface TaskMetadata {
  progress?: number; // 0-100
  progressStage?: string;
  error?: TaskError;
  cancelled?: boolean;
  cancelReason?: string;
  resumedAfterCrash?: boolean;
  customFields?: Record<string, unknown>;
  /** Reason why task is in waiting state (e.g., 'chat_serialized', 'model_loading') */
  waitReason?: 'chat_serialized' | 'model_loading' | string | null;
}

/**
 * UI context from frontend for tool-driven workflows
 */
export interface ActiveContext {
  workspaceId: string;
  projectId?: string;
  activeTarget?: TargetRef;
  selection?: ContentSelection;
  knowledgeScope?: {
    rootPageId?: string;
    mentionedPageIds?: string[];
    grantMode?: "exact";
    grantLifetime?: "turn";
  };
}

/**
 * Message payload - Chat completion with full conversation context
 */
export interface MessagePayload {
  chatId: string;
  messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    tool_call_id?: string;
  }>;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream: boolean;
  providerOptions?: Record<string, unknown>;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  activeContext?: ActiveContext;
  allowedTools?: string[];
}

/**
 * Load payload - Model loading for server/local providers
 */
export interface LoadPayload {
  modelPath: string;
  targetProvider: string;
  loadOptions?: Record<string, unknown>;
}

/**
 * Embedding payload - Generate embeddings
 */
export interface EmbeddingPayload {
  input: string | string[];
  embeddingOptions?: Record<string, unknown>;
}

/**
 * Content edit payload - AI-powered content editing
 */
export interface ContentEditPayload {
  /** Edit operation ID (links to content_edit_snapshot) */
  editId: string;
  /** Target type (e.g., "knowledge.page") */
  targetType: string;
  /** Target ID */
  targetId: string;
  /** Edit mode */
  mode: "replace" | "append" | "selection" | "generate";
  /** User instruction */
  instruction: string;
  /** Selection info for selection mode */
  selection?: {
    from: number;
    to: number;
    selectedText?: string;
  };
}

/**
 * Content edit task result data
 */
export interface ContentEditTaskResultData extends TaskResultData {
  data: {
    editId: string;
    contentApplied: boolean;
    markdownOutput?: string;
  };
}

/**
 * Valid task state transitions
 */
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["queued", "waiting", "cancelled"],
  queued: ["running", "cancelled"],
  waiting: ["queued", "cancelled"],
  running: ["streaming", "completed", "paused", "failed", "cancelled"],
  streaming: ["completed", "paused", "failed", "cancelled"],
  paused: ["queued", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

/**
 * Check if a task status is terminal (no further transitions)
 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}

/**
 * Check if a task status is active (running or streaming)
 */
export function isActiveStatus(status: TaskStatus): boolean {
  return status === "running" || status === "streaming";
}

/**
 * Validate if a state transition is allowed
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Chunks Table
// Stores streaming token chunks separately from task.result
// Supports incremental persistence and efficient replay
// ─────────────────────────────────────────────────────────────────────────────

export const taskChunk = sqliteTable(
  "task_chunk",
  {
    ...uuidPrimaryKey,

    // Task this chunk belongs to
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),

    // Sequence number within the task (for ordering)
    seq: integer("seq").notNull(),

    // Chunk content (token text)
    content: text("content").notNull(),

    // When the chunk was received
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    taskSeqIdx: index("idx_task_chunk_task_seq").on(table.taskId, table.seq),
    taskIdx: index("idx_task_chunk_task").on(table.taskId),
  })
);

export type TaskChunk = typeof taskChunk.$inferSelect;
export type NewTaskChunk = typeof taskChunk.$inferInsert;
