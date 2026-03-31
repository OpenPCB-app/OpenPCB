/**
 * Project Zod Schemas
 * 
 * Defines schemas for project endpoints with OpenAPI metadata.
 */
import { z, apiRegistry } from './base';
import { UUIDv7Schema, TimestampSchema } from './common';

// ============================================================================
// Project Enums & Metadata
// ============================================================================

export const ProjectStatusSchema = z.enum(['active', 'archived']).openapi({
    example: 'active',
    description: 'Project status'
});

export const ProjectMetadataSchema = z.record(z.string(), z.unknown());

export const ProjectAIConfigSchema = z.object({
    defaultProvider: z.string().optional(),
    defaultModel: z.string().optional(),
    systemPrompt: z.string().optional(),
    systemPromptMode: z.enum(['append', 'replace']).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int().optional(),
});

export const ProjectRAGConfigSchema = z.object({
    contextFileIds: z.array(z.string()).optional(),
    contextNotes: z.string().optional(),
    embeddingModel: z.string().optional(),
});

export const ProjectPreferencesSchema = z.object({
    showInSidebar: z.boolean().optional(),
    expandedByDefault: z.boolean().optional(),
    pinnedChats: z.array(z.string()).optional(),
});

// ============================================================================
// Project Entity
// ============================================================================

export const ProjectSchema = z.object({
    id: UUIDv7Schema,
    workspaceId: UUIDv7Schema.openapi({ description: 'Parent workspace ID' }),
    name: z.string().min(1).max(100).openapi({ example: 'My Project' }),
    description: z.string().nullable().optional(),
    status: ProjectStatusSchema,
    icon: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    sortOrder: z.number().int().nullable().optional(),
    aiConfig: ProjectAIConfigSchema.nullable().optional(),
    ragConfig: ProjectRAGConfigSchema.nullable().optional(),
    preferences: ProjectPreferencesSchema.nullable().optional(),
    // Deprecated legacy JSON bag retained for backward compatibility.
    metadata: ProjectMetadataSchema.nullable().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    deletedAt: TimestampSchema.nullable().optional(),
}).openapi('Project');

// ============================================================================
// Request/Response Schemas
// ============================================================================

export const CreateProjectInputSchema = z.object({
    workspaceId: UUIDv7Schema,
    name: z.string().min(1).max(100).openapi({ example: 'My Project' }),
    description: z.string().optional(),
    status: ProjectStatusSchema.optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
    sortOrder: z.number().int().optional(),
    aiConfig: ProjectAIConfigSchema.optional(),
    ragConfig: ProjectRAGConfigSchema.optional(),
    preferences: ProjectPreferencesSchema.optional(),
    // Deprecated legacy JSON bag retained for backward compatibility.
    metadata: ProjectMetadataSchema.optional(),
}).openapi('CreateProjectInput');

export const UpdateProjectInputSchema = z.object({
    name: z.string().min(1).max(100).optional().openapi({ example: 'Updated Project' }),
    description: z.string().nullable().optional(),
    status: ProjectStatusSchema.optional(),
    icon: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    sortOrder: z.number().int().nullable().optional(),
    aiConfig: ProjectAIConfigSchema.nullable().optional(),
    ragConfig: ProjectRAGConfigSchema.nullable().optional(),
    preferences: ProjectPreferencesSchema.nullable().optional(),
    // Deprecated legacy JSON bag retained for backward compatibility.
    metadata: ProjectMetadataSchema.nullable().optional(),
}).openapi('UpdateProjectInput');

// Response wrappers
export const ProjectResponseSchema = z.object({
    project: ProjectSchema,
}).openapi('ProjectResponse');

export const ProjectListResponseSchema = z.object({
    projects: z.array(ProjectSchema),
}).openapi('ProjectListResponse');

// ============================================================================
// Type Inference
// ============================================================================

export type ProjectSchemaType = z.infer<typeof ProjectSchema>;
export type CreateProjectInputType = z.infer<typeof CreateProjectInputSchema>;
export type UpdateProjectInputType = z.infer<typeof UpdateProjectInputSchema>;
