/**
 * SDK Index - Re-exports generated SDK with backward compatibility
 * 
 * Provides CoreSDK wrapper for existing code that uses the old API pattern.
 * New code should use the generated functions directly from generated/ subdirectories.
 */

// Re-export generated SDK functions
export * from './generated/workspaces/workspaces';
export * from './generated/projects/projects';
export * from './generated/chats/chats';
export * from './generated/tasks/tasks';
export * from './generated/providers/providers';
export * from './generated/stream/stream';
export * from './generated/health/health';

// Re-export generated types
export * from './generated/models';

// Import for CoreSDK wrapper
import { customFetch } from './mutator';
import { healthCheck } from './generated/health/health';
import {
    listWorkspaces,
    createWorkspace,
    getWorkspace,
    updateWorkspace,
    deleteWorkspace
} from './generated/workspaces/workspaces';

/**
 * CoreSDK - Backward compatibility wrapper
 * 
 * @deprecated Use individual generated functions instead (listWorkspaces, createWorkspace, etc.)
 * This wrapper maintains compatibility with existing code.
 */
export const CoreSDK = {
    /**
     * Health check endpoint
     * Returns true if backend is healthy, false otherwise
     */
    health: async (): Promise<boolean> => {
        try {
            // healthCheck returns the raw JSON from backend: { ok: true, data: { status: 'ok', ... } }
            const response = await healthCheck() as any;
            // The mutator returns raw JSON, so check it directly
            return response?.ok === true && response?.data?.status === 'ok';
        } catch (e) {
            console.error('[CoreSDK.health] Error:', e);
            return false;
        }
    },

    workspaces: {
        list: async () => {
            const response = await listWorkspaces() as any;
            // Raw JSON: { ok: true, data: { workspaces: [...] } }
            return response?.data?.workspaces || [];
        },
        get: async (id: string) => {
            const response = await getWorkspace(id) as any;
            return response?.data?.workspace;
        },
        create: async (input: { name: string; settings?: any }) => {
            const response = await createWorkspace(input) as any;
            return response?.data?.workspace;
        },
        update: async (id: string, input: { name?: string; settings?: any }) => {
            const response = await updateWorkspace(id, input) as any;
            return response?.data?.workspace;
        },
        delete: async (id: string) => {
            await deleteWorkspace(id);
        },
    },

    projects: {
        list: async (workspaceId?: string) => {
            // Manually add workspaceId query parameter if provided
            // The generated SDK doesn't support query params, so we construct the URL manually
            let url = '/api/projects';
            if (workspaceId) {
                url += `?workspaceId=${encodeURIComponent(workspaceId)}`;
            }
            const response = await customFetch(url, { method: 'GET' }) as any;
            return response?.data?.projects || [];
        },
    },
};
