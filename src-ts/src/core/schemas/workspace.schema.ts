/**
 * Workspace Zod Schemas
 * 
 * Defines schemas for workspace endpoints with OpenAPI metadata.
 */
import { z, apiRegistry } from './base';
import { UUIDv7Schema, TimestampSchema } from './common';

// ============================================================================
// Workspace Settings
// ============================================================================

export const WorkspaceSettingsSchema = z.object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    language: z.string().optional(),
    defaultProvider: z.string().optional(),
    defaultModel: z.string().optional(),
}).passthrough().openapi('WorkspaceSettings');

// ============================================================================
// Workspace Entity
// ============================================================================

export const WorkspaceSchema = z.object({
    id: UUIDv7Schema,
    name: z.string().min(1).max(100).openapi({ example: 'My Workspace' }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    settings: WorkspaceSettingsSchema,
}).openapi('Workspace');

// ============================================================================
// Request/Response Schemas
// ============================================================================

export const CreateWorkspaceInputSchema = z.object({
    name: z.string().min(1).max(100).openapi({ example: 'My Workspace' }),
    settings: WorkspaceSettingsSchema.optional(),
}).openapi('CreateWorkspaceInput');

export const UpdateWorkspaceInputSchema = z.object({
    name: z.string().min(1).max(100).optional().openapi({ example: 'Updated Workspace' }),
    settings: WorkspaceSettingsSchema.optional(),
}).openapi('UpdateWorkspaceInput');

// Response wrappers
export const WorkspaceResponseSchema = z.object({
    workspace: WorkspaceSchema,
}).openapi('WorkspaceResponse');

export const WorkspaceListResponseSchema = z.object({
    workspaces: z.array(WorkspaceSchema),
}).openapi('WorkspaceListResponse');

// ============================================================================
// Type Inference
// ============================================================================

export type WorkspaceSchemaType = z.infer<typeof WorkspaceSchema>;
export type CreateWorkspaceInputType = z.infer<typeof CreateWorkspaceInputSchema>;
export type UpdateWorkspaceInputType = z.infer<typeof UpdateWorkspaceInputSchema>;
