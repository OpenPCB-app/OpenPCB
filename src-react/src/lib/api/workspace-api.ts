
import { customFetch } from '@/../../src-ts/shared/sdk/mutator';
import type { WorkspaceRecord, UpdateWorkspaceInput } from '@shared/types';

interface ApiResponse<T> {
    ok: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

interface WorkspaceResponse {
    workspace: WorkspaceRecord;
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
    if (!response.ok || !response.data) {
        throw new Error(response.error?.message || 'API request failed');
    }
    return response.data;
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord> {
    const response = await customFetch<ApiResponse<WorkspaceResponse>>(`/api/workspaces/${id}`);
    const data = unwrapResponse(response);
    return data.workspace;
}

export async function updateWorkspace(id: string, input: UpdateWorkspaceInput): Promise<WorkspaceRecord> {
    const response = await customFetch<ApiResponse<WorkspaceResponse>>(
        `/api/workspaces/${id}`,
        {
            method: 'PATCH',
            body: JSON.stringify(input),
        }
    );
    const data = unwrapResponse(response);
    return data.workspace;
}
