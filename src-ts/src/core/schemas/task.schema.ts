/**
 * Task Zod Schemas
 * 
 * Defines schemas for task endpoints with OpenAPI metadata.
 */
import { z } from './base';
import { UUIDv7Schema, TimestampSchema } from './common';

// ============================================================================
// Task Enums
// ============================================================================

export const TaskStateSchema = z.enum([
    'pending', 'running', 'streaming', 'completed', 'failed', 'cancelled'
]).openapi({ example: 'running', description: 'Task state' });

export const TaskTypeSchema = z.enum(['chat', 'completion']).openapi({
    example: 'chat', description: 'Task type'
});

// ============================================================================
// Task Metadata
// ============================================================================

export const TaskMetaSchema = z.object({
    id: UUIDv7Schema,
    type: TaskTypeSchema,
    state: TaskStateSchema,
    createdAt: TimestampSchema,
    startedAt: TimestampSchema.optional(),
    completedAt: TimestampSchema.optional(),
    chatId: UUIDv7Schema.optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
}).openapi('TaskMeta');

// ============================================================================
// Token Usage
// ============================================================================

export const TokenUsageSchema = z.object({
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
    reasoningTokens: z.number().int().min(0).optional(),
}).openapi('TokenUsage');

// ============================================================================
// Task Result
// ============================================================================

export const TaskResultSuccessSchema = z.object({
    ok: z.literal(true),
    text: z.string(),
    reasoningText: z.string().optional(),
    usage: TokenUsageSchema.optional(),
    finishReason: z.string().optional(),
}).openapi('TaskResultSuccess');

export const TaskResultFailureSchema = z.object({
    ok: z.literal(false),
    error: z.object({
        message: z.string(),
        code: z.string().optional(),
    }),
}).openapi('TaskResultFailure');

// ============================================================================
// Response Schemas
// ============================================================================

export const TaskResponseSchema = z.object({
    task: TaskMetaSchema,
}).openapi('TaskResponse');

export const TaskListResponseSchema = z.object({
    tasks: z.array(TaskMetaSchema),
}).openapi('TaskListResponse');

export const TaskMetaResponseSchema = z.object({
    meta: TaskMetaSchema,
}).openapi('TaskMetaResponse');

// ============================================================================
// Type Inference
// ============================================================================

export type TaskMetaType = z.infer<typeof TaskMetaSchema>;
export type TokenUsageType = z.infer<typeof TokenUsageSchema>;
