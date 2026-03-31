/**
 * Stream Zod Schemas
 * 
 * Defines schemas for stream/chat endpoints with OpenAPI metadata.
 */
import { z } from './base';
import { UUIDv7Schema } from './common';
import { ProviderIdSchema } from './provider.schema';

// ============================================================================
// Stream Request
// ============================================================================

export const StreamChatRequestSchema = z.object({
    chatId: UUIDv7Schema,
    provider: ProviderIdSchema,
    model: z.string().openapi({ example: 'gpt-4o' }),
    messages: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
    })),
    systemPrompt: z.string().optional(),
    apiKey: z.string().optional().openapi({ description: 'API key for the provider' }),
}).openapi('StreamChatRequest');

// ============================================================================
// Stream Response
// ============================================================================

export const StreamStartResponseSchema = z.object({
    taskId: UUIDv7Schema,
    status: z.literal('streaming'),
}).openapi('StreamStartResponse');

export const StreamAbortResponseSchema = z.object({
    taskId: UUIDv7Schema,
    status: z.literal('cancelled'),
}).openapi('StreamAbortResponse');

// ============================================================================
// Type Inference
// ============================================================================

export type StreamChatRequestType = z.infer<typeof StreamChatRequestSchema>;
export type StreamStartResponseType = z.infer<typeof StreamStartResponseSchema>;
