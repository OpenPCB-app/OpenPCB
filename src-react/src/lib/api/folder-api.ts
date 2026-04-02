import { customFetch } from "@shared/sdk/mutator";
import type { FolderRecord } from "@shared/types";

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

export async function listFolders(
  workspaceId: string,
): Promise<FolderRecord[]> {
  const params = new URLSearchParams({ workspaceId });
  const response = await customFetch<ApiResponse<{ folders: FolderRecord[] }>>(
    `/api/folders?${params.toString()}`,
  );
  return unwrapResponse(response).folders;
}

export async function getFolder(id: string): Promise<FolderRecord> {
  const response = await customFetch<ApiResponse<{ folder: FolderRecord }>>(
    `/api/folders/${id}`,
  );
  return unwrapResponse(response).folder;
}

export async function createFolder(
  workspaceId: string,
  name: string,
  sortOrder?: number,
): Promise<FolderRecord> {
  const response = await customFetch<ApiResponse<{ folder: FolderRecord }>>(
    "/api/folders",
    {
      method: "POST",
      body: JSON.stringify({ workspaceId, name, sortOrder }),
    },
  );
  return unwrapResponse(response).folder;
}

export async function updateFolder(
  id: string,
  updates: { name?: string; sortOrder?: number; isExpanded?: boolean },
): Promise<FolderRecord> {
  const response = await customFetch<ApiResponse<{ folder: FolderRecord }>>(
    `/api/folders/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
  );
  return unwrapResponse(response).folder;
}

export async function deleteFolder(
  id: string,
  action?: "move_to_root" | "delete_chats",
): Promise<void> {
  const params = action ? `?action=${action}` : "";
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/folders/${id}${params}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}
