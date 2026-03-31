#!/usr/bin/env bun

/**
 * OpenAPI Specification Generator
 * 
 * Generates openapi.json from CoreRouter schema metadata.
 * Run with: bun scripts/generate-openapi.ts
 */

import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Import all schemas to ensure they're registered
import '../src-ts/src/core/schemas';

// Import z for inline schemas
import { z } from '../src-ts/src/core/schemas';

// Import schema exports
import {
    WorkspaceSchema, WorkspaceListResponseSchema, WorkspaceResponseSchema,
    CreateWorkspaceInputSchema, UpdateWorkspaceInputSchema,
    ProjectSchema, ProjectListResponseSchema, ProjectResponseSchema,
    CreateProjectInputSchema, UpdateProjectInputSchema,
    ChatMetadataSchema, ChatListResponseSchema, ChatResponseSchema,
    CreateChatInputSchema, UpdateChatInputSchema,
    TaskMetaSchema, TaskListResponseSchema, TaskResponseSchema, TaskMetaResponseSchema,
    ProviderInfoSchema, ProviderListResponseSchema, ProviderResponseSchema,
    StreamChatRequestSchema, StreamStartResponseSchema, StreamAbortResponseSchema,
    DeletedResponseSchema,
} from '../src-ts/src/core/schemas';

const ROOT = resolve(import.meta.dir, '..');

// Create a fresh registry for OpenAPI generation
const registry = new OpenAPIRegistry();

// ============================================================================
// Helper Functions
// ============================================================================

function extractPathParams(path: string): string[] {
    const matches = path.match(/\{([^}]+)\}/g);
    if (!matches) return [];
    return matches.map(m => m.slice(1, -1));
}

function registerPath(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    operationId: string,
    tags: string[],
    summary: string,
    options?: {
        requestBody?: z.ZodTypeAny;
        responses?: Record<number, z.ZodTypeAny>;
    }
) {
    const config: any = {
        method,
        path,
        operationId,
        tags,
        summary,
        responses: {},
    };

    // Add request body if present
    if (options?.requestBody) {
        config.request = config.request || {};
        config.request.body = {
            content: {
                'application/json': {
                    schema: options.requestBody,
                },
            },
        };
    }

    // Add responses
    if (options?.responses) {
        for (const [status, schema] of Object.entries(options.responses)) {
            config.responses[status] = {
                description: `Response ${status}`,
                content: {
                    'application/json': {
                        schema,
                    },
                },
            };
        }
    }

    registry.registerPath(config);
}

// ============================================================================
// Register All Endpoints
// ============================================================================

// Health
registerPath('get', '/api/health', 'healthCheck', ['Health'], 'Health check endpoint', {
    responses: { 200: z.object({ ok: z.literal(true), data: z.object({ status: z.literal('ok'), timestamp: z.number() }) }) },
});

// Workspaces
registerPath('get', '/api/workspaces', 'listWorkspaces', ['Workspaces'], 'List all workspaces', {
    responses: { 200: z.object({ ok: z.literal(true), data: WorkspaceListResponseSchema }) },
});
registerPath('post', '/api/workspaces', 'createWorkspace', ['Workspaces'], 'Create a new workspace', {
    requestBody: CreateWorkspaceInputSchema,
    responses: { 201: z.object({ ok: z.literal(true), data: WorkspaceResponseSchema }) },
});
registerPath('get', '/api/workspaces/{id}', 'getWorkspace', ['Workspaces'], 'Get workspace by ID', {
    responses: { 200: z.object({ ok: z.literal(true), data: WorkspaceResponseSchema }) },
});
registerPath('patch', '/api/workspaces/{id}', 'updateWorkspace', ['Workspaces'], 'Update workspace by ID', {
    requestBody: UpdateWorkspaceInputSchema,
    responses: { 200: z.object({ ok: z.literal(true), data: WorkspaceResponseSchema }) },
});
registerPath('delete', '/api/workspaces/{id}', 'deleteWorkspace', ['Workspaces'], 'Delete workspace by ID', {
    responses: { 200: z.object({ ok: z.literal(true), data: DeletedResponseSchema }) },
});

// Projects
registerPath('get', '/api/projects', 'listProjects', ['Projects'], 'List all projects', {
    responses: { 200: z.object({ ok: z.literal(true), data: ProjectListResponseSchema }) },
});
registerPath('post', '/api/projects', 'createProject', ['Projects'], 'Create a new project', {
    requestBody: CreateProjectInputSchema,
    responses: { 201: z.object({ ok: z.literal(true), data: ProjectResponseSchema }) },
});
registerPath('get', '/api/projects/{id}', 'getProject', ['Projects'], 'Get project by ID', {
    responses: { 200: z.object({ ok: z.literal(true), data: ProjectResponseSchema }) },
});
registerPath('patch', '/api/projects/{id}', 'updateProject', ['Projects'], 'Update project by ID', {
    requestBody: UpdateProjectInputSchema,
    responses: { 200: z.object({ ok: z.literal(true), data: ProjectResponseSchema }) },
});
registerPath('delete', '/api/projects/{id}', 'deleteProject', ['Projects'], 'Delete project by ID', {
    responses: { 200: z.object({ ok: z.literal(true), data: DeletedResponseSchema }) },
});

// Chats
registerPath('get', '/api/chats', 'listChats', ['Chats'], 'List all chats', {
    responses: { 200: z.object({ ok: z.literal(true), data: ChatListResponseSchema }) },
});
registerPath('post', '/api/chats', 'createChat', ['Chats'], 'Create a new chat', {
    requestBody: CreateChatInputSchema,
    responses: { 201: z.object({ ok: z.literal(true), data: ChatResponseSchema }) },
});
registerPath('get', '/api/chats/{id}', 'getChat', ['Chats'], 'Get chat by ID', {
    responses: { 200: z.object({ ok: z.literal(true), data: ChatResponseSchema }) },
});
registerPath('patch', '/api/chats/{id}', 'updateChat', ['Chats'], 'Update chat by ID', {
    requestBody: UpdateChatInputSchema,
    responses: { 200: z.object({ ok: z.literal(true), data: ChatResponseSchema }) },
});
registerPath('delete', '/api/chats/{id}', 'deleteChat', ['Chats'], 'Delete chat by ID', {
    responses: { 200: z.object({ ok: z.literal(true), data: DeletedResponseSchema }) },
});

// Tasks
registerPath('get', '/api/tasks', 'listTasks', ['Tasks'], 'List all tasks', {
    responses: { 200: z.object({ ok: z.literal(true), data: TaskListResponseSchema }) },
});
registerPath('get', '/api/tasks/{id}', 'getTask', ['Tasks'], 'Get task by ID', {
    responses: { 200: z.object({ ok: z.literal(true), data: TaskResponseSchema }) },
});
registerPath('get', '/api/tasks/{id}/meta', 'getTaskMeta', ['Tasks'], 'Get task metadata', {
    responses: { 200: z.object({ ok: z.literal(true), data: TaskMetaResponseSchema }) },
});
registerPath('post', '/api/tasks/{id}/cancel', 'cancelTask', ['Tasks'], 'Cancel a running task', {
    responses: { 200: z.object({ ok: z.literal(true), data: z.object({ cancelled: z.literal(true) }) }) },
});
registerPath('post', '/api/tasks/cleanup', 'cleanupTasks', ['Tasks'], 'Cleanup completed tasks', {
    responses: { 200: z.object({ ok: z.literal(true), data: z.object({ cleaned: z.number() }) }) },
});

// Providers
registerPath('get', '/api/providers', 'listProviders', ['Providers'], 'List all AI providers', {
    responses: { 200: z.object({ ok: z.literal(true), data: ProviderListResponseSchema }) },
});
registerPath('get', '/api/providers/{id}', 'getProvider', ['Providers'], 'Get provider with models', {
    responses: { 200: z.object({ ok: z.literal(true), data: ProviderResponseSchema }) },
});

// Stream
registerPath('post', '/api/stream/chat', 'streamChat', ['Stream'], 'Start a chat stream', {
    requestBody: StreamChatRequestSchema,
    responses: { 200: StreamStartResponseSchema },
});
registerPath('post', '/api/stream/abort/{taskId}', 'abortStream', ['Stream'], 'Abort a running stream', {
    responses: { 200: StreamAbortResponseSchema },
});

// ============================================================================
// Generate OpenAPI Document
// ============================================================================

const generator = new OpenApiGeneratorV31(registry.definitions);

const document = generator.generateDocument({
    openapi: '3.1.0',
    info: {
        title: 'OpenPCB API',
        version: '1.0.0',
        description: 'OpenPCB Bun Backend API - Auto-generated from endpoint schemas',
        contact: {
            name: 'OpenPCB',
        },
    },
    servers: [
        { url: 'http://127.0.0.1:3000', description: 'Development' },
    ],
    tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'Workspaces', description: 'Workspace management' },
        { name: 'Projects', description: 'Project management' },
        { name: 'Chats', description: 'Chat management' },
        { name: 'Tasks', description: 'Background task management' },
        { name: 'Providers', description: 'AI provider configuration' },
        { name: 'Stream', description: 'Real-time streaming' },
    ],
});

// ============================================================================
// Post-process: Add path parameters to paths with {param} syntax
// ============================================================================

if (document.paths) {
    for (const [pathKey, pathValue] of Object.entries(document.paths)) {
        const pathParams = extractPathParams(pathKey);
        if (pathParams.length > 0) {
            const paramDefs = pathParams.map(name => ({
                name,
                in: 'path',
                required: true,
                schema: {
                    type: 'string',
                    format: 'uuid',
                },
                example: '01935c4a-1b2d-7e3f-8c9d-0e1f2a3b4c5d',
            }));

            // Add to each method in this path
            for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
                const op = (pathValue as any)[method];
                if (op) {
                    op.parameters = [...paramDefs, ...(op.parameters || [])];
                }
            }
        }
    }
}

// Write to file
const outputPath = resolve(ROOT, 'openapi.json');
writeFileSync(outputPath, JSON.stringify(document, null, 2));

console.log('✅ Generated openapi.json');
console.log(`   Output: ${outputPath}`);
console.log(`   Paths: ${Object.keys(document.paths || {}).length}`);
