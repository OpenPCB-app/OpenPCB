import { customFetch } from "@/../../src-ts/shared/sdk/mutator";
import type { ProjectRecord, UpdateProjectInput } from "@shared/types";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || "API request failed");
  }
  return response.data;
}

export async function listProjects(
  workspaceId: string,
): Promise<ProjectRecord[]> {
  const params = new URLSearchParams({ workspaceId });
  const response = await customFetch<
    ApiResponse<{ projects: ProjectRecord[] }>
  >(`/api/projects?${params.toString()}`);
  return unwrapResponse(response).projects;
}

export async function getProject(id: string): Promise<ProjectRecord> {
  const response = await customFetch<ApiResponse<{ project: ProjectRecord }>>(
    `/api/projects/${encodeURIComponent(id)}`,
  );
  return unwrapResponse(response).project;
}

export async function createProject(
  workspaceId: string,
  name: string,
  description?: string,
  icon?: string,
  color?: string,
): Promise<ProjectRecord> {
  const response = await customFetch<ApiResponse<{ project: ProjectRecord }>>(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, name, description, icon, color }),
    },
  );
  return unwrapResponse(response).project;
}

export async function updateProject(
  id: string,
  updates: UpdateProjectInput,
): Promise<ProjectRecord> {
  const response = await customFetch<ApiResponse<{ project: ProjectRecord }>>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
  );
  return unwrapResponse(response).project;
}

export async function deleteProject(id: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/projects/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}
