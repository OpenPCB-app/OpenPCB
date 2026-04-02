import { customFetch } from "@shared/sdk/mutator";
import type {
  FileReferenceWithChat,
  FileTypeFilter,
} from "@shared/types/file.types";

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

export async function listFiles(
  workspaceId: string,
  options?: { type?: FileTypeFilter; limit?: number },
): Promise<FileReferenceWithChat[]> {
  const params = new URLSearchParams({ workspaceId });
  if (options?.type) params.set("type", options.type);
  if (options?.limit !== undefined)
    params.set("limit", options.limit.toString());

  const response = await customFetch<
    ApiResponse<{ files: FileReferenceWithChat[] }>
  >(`/api/files?${params.toString()}`);
  return unwrapResponse(response).files;
}

export async function getFile(id: string): Promise<FileReferenceWithChat> {
  const response = await customFetch<
    ApiResponse<{ file: FileReferenceWithChat }>
  >(`/api/files/${encodeURIComponent(id)}`);
  return unwrapResponse(response).file;
}

export async function listFilesByChat(
  chatId: string,
): Promise<FileReferenceWithChat[]> {
  const response = await customFetch<
    ApiResponse<{ files: FileReferenceWithChat[] }>
  >(`/api/chats/${encodeURIComponent(chatId)}/files`);
  return unwrapResponse(response).files;
}
