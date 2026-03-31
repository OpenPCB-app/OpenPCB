/**
 * Chat API Client
 *
 * HTTP client functions for chat CRUD operations
 * Uses the custom fetch mutator with dynamic backend URL
 */

import { customFetch, getBackendURL } from "@/../../src-ts/shared/sdk/mutator";
import type {
  ChatMetadata,
  CreateChatInput,
  UpdateChatInput,
  KernelMessage,
} from "@shared/types";

// Backend wraps all responses in ApiResponse format
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// Data payload types
interface ChatResponseData {
  chat: ChatMetadata;
}

interface ChatListResponseData {
  chats: ChatMetadata[];
  total?: number;
}

interface DeleteResponseData {
  deleted: boolean;
}

interface MessagesResponseData {
  messages: KernelMessage[];
}

/**
 * Unwrap ApiResponse, throwing if not ok
 */
function unwrapResponse<T>(response: ApiResponse<T>): T {
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || "API request failed");
  }
  return response.data;
}

/**
 * List all chats for a workspace
 * @param folderId - undefined = all chats, null = root level only, string = specific folder
 * @param excludeCategories - categories to exclude (e.g., ['brainstorming_node'])
 * @param projectId - undefined = all chats, null = workspace-level only, string = specific project
 */
export async function listChats(
  workspaceId: string,
  limit?: number,
  folderId?: string | null,
  excludeCategories?: string[],
  projectId?: string | null,
  contextFilters?: {
    category?: string | null;
    contextType?: string;
    contextId?: string;
  },
): Promise<ChatMetadata[]> {
  const params = new URLSearchParams();
  params.set("workspaceId", workspaceId);
  if (limit) {
    params.set("limit", limit.toString());
  }
  if (folderId !== undefined) {
    params.set("folderId", folderId === null ? "null" : folderId);
  }
  if (excludeCategories?.length) {
    params.set("excludeCategories", excludeCategories.join(","));
  }
  if (projectId !== undefined) {
    params.set("projectId", projectId === null ? "null" : projectId);
  }
  if (contextFilters?.category !== undefined) {
    params.set(
      "category",
      contextFilters.category === null ? "null" : contextFilters.category,
    );
  }
  if (contextFilters?.contextType) {
    params.set("contextType", contextFilters.contextType);
  }
  if (contextFilters?.contextId) {
    params.set("contextId", contextFilters.contextId);
  }

  const response = await customFetch<ApiResponse<ChatListResponseData>>(
    `/api/chats?${params.toString()}`,
  );

  const data = unwrapResponse(response);
  return data.chats;
}

export async function findChatByContext(input: {
  workspaceId: string;
  category: string;
  contextType: string;
  contextId: string;
}): Promise<ChatMetadata | null> {
  const chats = await listChats(
    input.workspaceId,
    1,
    undefined,
    undefined,
    undefined,
    {
      category: input.category,
      contextType: input.contextType,
      contextId: input.contextId,
    },
  );
  return chats[0] ?? null;
}

/**
 * Get a single chat by ID
 */
export async function getChat(id: string): Promise<ChatMetadata> {
  const response = await customFetch<ApiResponse<ChatResponseData>>(
    `/api/chats/${id}`,
  );
  const data = unwrapResponse(response);
  return data.chat;
}

/**
 * Create a new chat
 */
export async function createChat(
  input: CreateChatInput,
  workspaceId: string,
): Promise<ChatMetadata> {
  const response = await customFetch<ApiResponse<ChatResponseData>>(
    "/api/chats",
    {
      method: "POST",
      body: JSON.stringify({ ...input, workspaceId }),
    },
  );

  const data = unwrapResponse(response);
  return data.chat;
}

/**
 * Update an existing chat
 */
export async function updateChat(
  id: string,
  input: UpdateChatInput,
): Promise<ChatMetadata> {
  const response = await customFetch<ApiResponse<ChatResponseData>>(
    `/api/chats/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );

  const data = unwrapResponse(response);
  return data.chat;
}

/**
 * Delete a chat (soft delete)
 */
export async function deleteChat(id: string): Promise<void> {
  const response = await customFetch<ApiResponse<DeleteResponseData>>(
    `/api/chats/${id}`,
    {
      method: "DELETE",
    },
  );
  unwrapResponse(response);
}

/**
 * Bulk delete chats (soft delete)
 */
export async function deleteChats(ids: string[]): Promise<number> {
  const response = await customFetch<ApiResponse<{ deleted: boolean; count: number }>>(
    "/api/chats/bulk-delete",
    {
      method: "POST",
      body: JSON.stringify({ ids }),
    },
  );
  const data = unwrapResponse(response);
  return data.count;
}

/**
 * Move a chat to a folder (or remove from folder if folderId is null)
 */
export async function moveChatToFolder(
  chatId: string,
  folderId: string | null,
): Promise<ChatMetadata> {
  return updateChat(chatId, { folderId });
}

/**
 * Move a chat to a project (or remove from project if projectId is null)
 */
export async function moveChatToProject(
  chatId: string,
  projectId: string | null,
): Promise<ChatMetadata> {
  return updateChat(chatId, { projectId });
}

/**
 * Fork a chat from a specific message
 */
export async function forkChat(
  chatId: string,
  fromMessageId: string,
): Promise<{ chat: { id: string; title: string }; messageCount: number }> {
  const response = await customFetch<ApiResponse<{ chat: { id: string; title: string }; messageCount: number }>>(
    `/api/chats/${chatId}/fork`,
    {
      method: "POST",
      body: JSON.stringify({ fromMessageId }),
    },
  );

  const data = unwrapResponse(response);
  return data;
}

/**
 * Get all messages for a chat
 */
export async function getChatMessages(
  chatId: string,
): Promise<KernelMessage[]> {
  const response = await customFetch<ApiResponse<MessagesResponseData>>(
    `/api/chats/${chatId}/messages`,
  );
  const data = unwrapResponse(response);
  return data.messages;
}

/**
 * Active task info returned by the backend
 */
export interface ActiveTaskInfo {
  taskId: string;
  status: string;
  provider: string;
  model: string;
  createdAt: string;
  assistantMessageId?: string | null;
  waitReason?: string | null;
  resumeEligible: boolean;
}

/**
 * Check if a chat has an active (running/streaming) task
 * Returns task info if active, null if no active task
 *
 * NOTE: Uses raw fetch instead of customFetch because 204 responses
 * have no body and customFetch always tries to parse JSON
 */
export async function getActiveTask(
  chatId: string,
): Promise<ActiveTaskInfo | null> {
  const baseUrl = getBackendURL();

  if (!baseUrl) {
    console.warn("[getActiveTask] Backend URL not ready");
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}/api/chats/${chatId}/active-task`, {
      headers: { "Content-Type": "application/json" },
    });

    // 204 No Content = no active task
    if (response.status === 204) {
      return null;
    }

    // Only parse JSON for successful responses with content
    if (response.ok) {
      const json = (await response.json()) as ApiResponse<ActiveTaskInfo>;
      return json.data ?? null;
    }

    // Non-ok response, treat as no active task
    return null;
  } catch (error) {
    console.warn("[getActiveTask] Error checking active task:", error);
    return null;
  }
}
