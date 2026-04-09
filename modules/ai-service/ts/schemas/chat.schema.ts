/**
 * Chat Zod Schemas
 *
 * Defines schemas for chat endpoints with OpenAPI metadata.
 */
import { z } from "./base";
import { UUIDv7Schema, TimestampSchema } from "./common";
import { ProviderIdSchema } from "./provider.schema";

// ============================================================================
// Chat Config & Icon
// ============================================================================

export const ChatIconNameSchema = z.enum([
  "message-square",
  "bot",
  "terminal",
  "book-open",
  "sparkles",
  "lightbulb",
]);

export const ChatIconColorSchema = z.enum([
  "sky",
  "violet",
  "amber",
  "emerald",
  "rose",
  "slate",
]);

export const ChatIconSchema = z
  .object({
    name: ChatIconNameSchema,
    color: ChatIconColorSchema,
  })
  .openapi("ChatIcon");

export const ChatConfigSchema = z
  .object({
    provider: ProviderIdSchema,
    model: z.string().openapi({ example: "gpt-4o" }),
    systemPrompt: z.string().nullable(),
  })
  .openapi("ChatConfig");

export const ChatContextRefSchema = z
  .object({
    type: z.string().openapi({ example: "knowledge_page" }),
    id: UUIDv7Schema,
  })
  .openapi("ChatContextRef");

// ============================================================================
// Chat Entity
// ============================================================================

export const ChatMetadataSchema = z
  .object({
    id: UUIDv7Schema,
    workspaceId: UUIDv7Schema,
    title: z.string().openapi({ example: "New Chat" }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    config: ChatConfigSchema,
    messageCount: z.number().int().min(0),
    lastMessagePreview: z.string().nullable(),
    tags: z.array(z.string()),
    pinned: z.boolean(),
    archived: z.boolean(),
    icon: ChatIconSchema.nullable(),
    folderId: UUIDv7Schema.nullable(),
    projectId: UUIDv7Schema.nullable(),
    category: z.string().nullable().optional(),
    contextRef: ChatContextRefSchema.nullable().optional(),
  })
  .openapi("ChatMetadata");

// ============================================================================
// Request/Response Schemas
// ============================================================================

export const CreateChatInputSchema = z
  .object({
    title: z.string().optional().openapi({ example: "New Chat" }),
    config: ChatConfigSchema.partial().optional(),
    icon: ChatIconSchema.optional(),
    category: z.string().optional(),
    contextRef: ChatContextRefSchema.optional(),
  })
  .openapi("CreateChatInput");

export const UpdateChatInputSchema = z
  .object({
    title: z.string().optional(),
    config: ChatConfigSchema.partial().optional(),
    tags: z.array(z.string()).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    icon: ChatIconSchema.nullable().optional(),
    folderId: UUIDv7Schema.nullable().optional(),
    projectId: UUIDv7Schema.nullable().optional(),
    category: z.string().nullable().optional(),
    contextRef: ChatContextRefSchema.nullable().optional(),
  })
  .openapi("UpdateChatInput");

// Response wrappers
export const ChatResponseSchema = z
  .object({
    chat: ChatMetadataSchema,
  })
  .openapi("ChatResponse");

export const ChatListResponseSchema = z
  .object({
    chats: z.array(ChatMetadataSchema),
  })
  .openapi("ChatListResponse");

// ============================================================================
// Message Creation (POST /api/chats/:id/messages)
// See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
// ============================================================================

export const CreateMessageInputSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .openapi({ example: "Hello, how can you help me?" }),
    provider: ProviderIdSchema.optional().openapi({
      description: "Override provider (defaults to chat config)",
    }),
    model: z.string().optional().openapi({
      description: "Override model (defaults to chat config)",
      example: "gpt-4o",
    }),
    priority: z.number().int().min(0).max(100).optional().openapi({
      description: "Task priority (0-100, default 50)",
      example: 50,
    }),
  })
  .openapi("CreateMessageInput");

export const CreateMessageResponseSchema = z
  .object({
    taskId: UUIDv7Schema.openapi({ description: "ID of the created AI task" }),
    userMessageId: UUIDv7Schema.openapi({
      description: "ID of the user message",
    }),
    status: z.string().openapi({
      description: "Initial task status (pending, waiting, queued)",
      example: "queued",
    }),
    dependsOn: UUIDv7Schema.optional().openapi({
      description:
        "ID of LoadTask this message depends on (if model loading required)",
    }),
    queuePosition: z.number().int().optional().openapi({
      description: "Position in provider queue",
    }),
  })
  .openapi("CreateMessageResponse");

// ============================================================================
// Type Inference
// ============================================================================

export type ChatMetadataType = z.infer<typeof ChatMetadataSchema>;
export type CreateChatInputType = z.infer<typeof CreateChatInputSchema>;
export type UpdateChatInputType = z.infer<typeof UpdateChatInputSchema>;
export type CreateMessageInputType = z.infer<typeof CreateMessageInputSchema>;
export type CreateMessageResponseType = z.infer<
  typeof CreateMessageResponseSchema
>;
