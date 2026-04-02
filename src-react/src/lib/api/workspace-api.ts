import { customFetch } from "@/../../src-ts/shared/sdk/mutator";
import type {
  WorkspaceRecord,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from "@shared/types";

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

interface WorkspaceListResponse {
  workspaces: WorkspaceRecord[];
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || "API request failed");
  }
  return response.data;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response =
      await customFetch<ApiResponse<{ status: string }>>("/api/health");
    return response?.ok === true && response?.data?.status === "ok";
  } catch {
    return false;
  }
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const response =
    await customFetch<ApiResponse<WorkspaceListResponse>>("/api/workspaces");
  const data = unwrapResponse(response);
  return data.workspaces;
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord> {
  const response = await customFetch<ApiResponse<WorkspaceResponse>>(
    `/api/workspaces/${id}`,
  );
  const data = unwrapResponse(response);
  return data.workspace;
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<WorkspaceRecord> {
  const response = await customFetch<ApiResponse<WorkspaceResponse>>(
    "/api/workspaces",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  const data = unwrapResponse(response);
  return data.workspace;
}

export async function updateWorkspace(
  id: string,
  input: UpdateWorkspaceInput,
): Promise<WorkspaceRecord> {
  const response = await customFetch<ApiResponse<WorkspaceResponse>>(
    `/api/workspaces/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  const data = unwrapResponse(response);
  return data.workspace;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await customFetch<ApiResponse<unknown>>(`/api/workspaces/${id}`, {
    method: "DELETE",
  });
}
