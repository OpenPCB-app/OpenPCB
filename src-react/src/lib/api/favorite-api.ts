import { customFetch } from "@shared/sdk/mutator";
import type { FavoriteWithChat } from "@shared/types/favorite.types";

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

export async function listFavorites(
  workspaceId: string,
): Promise<FavoriteWithChat[]> {
  const params = new URLSearchParams({ workspaceId });
  const response = await customFetch<
    ApiResponse<{ favorites: FavoriteWithChat[] }>
  >(`/api/favorites?${params.toString()}`);
  return unwrapResponse(response).favorites;
}

export async function addFavorite(
  workspaceId: string,
  chatId: string,
  sortOrder?: number,
): Promise<FavoriteWithChat> {
  const response = await customFetch<
    ApiResponse<{ favorite: FavoriteWithChat }>
  >("/api/favorites", {
    method: "POST",
    body: JSON.stringify({ workspaceId, chatId, sortOrder }),
  });
  return unwrapResponse(response).favorite;
}

export async function removeFavorite(id: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/favorites/${id}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}

export async function removeFavoriteByChat(chatId: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/favorites/chat/${chatId}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}

export async function checkFavoriteStatus(
  workspaceId: string,
  chatId: string,
): Promise<boolean> {
  const params = new URLSearchParams({ workspaceId, chatId });
  const response = await customFetch<ApiResponse<{ isFavorite: boolean }>>(
    `/api/favorites/status?${params.toString()}`,
  );
  return unwrapResponse(response).isFavorite;
}

export async function updateFavoriteSortOrder(
  id: string,
  sortOrder: number,
): Promise<void> {
  const response = await customFetch<ApiResponse<{ favorite: FavoriteWithChat }>>(
    `/api/favorites/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sortOrder }),
    },
  );
  unwrapResponse(response);
}
