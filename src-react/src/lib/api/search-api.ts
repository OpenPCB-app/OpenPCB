import { customFetch } from "@/../../src-ts/shared/sdk/mutator";
import type { KernelMessage } from "@shared/types";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface SearchResult {
  id: string;
  chatId: string;
  chatTitle?: string;
  role: string;
  parts: KernelMessage["parts"];
  createdAt: string;
  snippet?: string;
}

interface SearchResponseData {
  messages: SearchResult[];
  total: number;
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || "API request failed");
  }
  return response.data;
}

export interface SearchOptions {
  workspaceId?: string;
  chatId?: string;
  limit?: number;
  signal?: AbortSignal;
}

export async function searchMessages(
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const params = new URLSearchParams();
  params.set("q", query);

  if (options?.workspaceId) {
    params.set("workspaceId", options.workspaceId);
  }
  if (options?.chatId) {
    params.set("chatId", options.chatId);
  }
  if (options?.limit) {
    params.set("limit", options.limit.toString());
  }

  const response = await customFetch<ApiResponse<SearchResponseData>>(
    `/api/messages/search?${params.toString()}`,
    options?.signal ? { signal: options.signal } : undefined,
  );

  const data = unwrapResponse(response);
  return data.messages;
}
