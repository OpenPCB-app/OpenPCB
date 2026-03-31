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

// ============================================================================
// Project Entity
// ============================================================================

export const ProjectSchema = z.object({
    id: UUIDv7Schema,
    workspaceId: UUIDv7Schema.openapi({ description: 'Parent workspace ID' }),
    name: z.string().min(1).max(100).openapi({ example: 'My Project' }),
    status: ProjectStatusSchema,
    metadata: ProjectMetadataSchema.optional(),
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
    status: ProjectStatusSchema.optional(),
    metadata: ProjectMetadataSchema.optional(),
}).openapi('CreateProjectInput');

export const UpdateProjectInputSchema = z.object({
    name: z.string().min(1).max(100).optional().openapi({ example: 'Updated Project' }),
    status: ProjectStatusSchema.optional(),
    metadata: ProjectMetadataSchema.optional(),
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
