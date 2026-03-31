import { customFetch } from "@/../../src-ts/shared/sdk/mutator";
import type {
  BookmarkRecord,
  BookmarkWithMessage,
  CreateBookmarkInput,
} from "@shared/types/bookmark.types";

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

export async function listBookmarks(
  workspaceId: string,
): Promise<BookmarkWithMessage[]> {
  const params = new URLSearchParams({ workspaceId });
  const response = await customFetch<
    ApiResponse<{ bookmarks: BookmarkWithMessage[] }>
  >(`/api/bookmarks?${params.toString()}`);
  return unwrapResponse(response).bookmarks;
}

export async function listBookmarksByChat(
  chatId: string,
): Promise<BookmarkWithMessage[]> {
  const params = new URLSearchParams({ chatId });
  const response = await customFetch<
    ApiResponse<{ bookmarks: BookmarkWithMessage[] }>
  >(`/api/bookmarks?${params.toString()}`);
  return unwrapResponse(response).bookmarks;
}

export async function createBookmark(
  input: CreateBookmarkInput,
): Promise<BookmarkRecord> {
  const response = await customFetch<ApiResponse<{ bookmark: BookmarkRecord }>>(
    "/api/bookmarks",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return unwrapResponse(response).bookmark;
}

export async function updateBookmarkNote(
  id: string,
  note: string | null,
): Promise<BookmarkRecord> {
  const response = await customFetch<ApiResponse<{ bookmark: BookmarkRecord }>>(
    `/api/bookmarks/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ note }),
    },
  );
  return unwrapResponse(response).bookmark;
}

export async function removeBookmark(id: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/bookmarks/${id}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}

export async function removeBookmarkByMessage(messageId: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/bookmarks/message/${messageId}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}

export async function checkBookmarkStatus(
  workspaceId: string,
  messageId: string,
): Promise<boolean> {
  const params = new URLSearchParams({ workspaceId, messageId });
  const response = await customFetch<ApiResponse<{ isBookmarked: boolean }>>(
    `/api/bookmarks/status?${params.toString()}`,
  );
  return unwrapResponse(response).isBookmarked;
}
