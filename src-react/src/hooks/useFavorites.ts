import { useState, useEffect, useCallback } from "react";
import {
  listFavorites,
  addFavorite,
  removeFavoriteByChat,
  updateFavoriteSortOrder,
} from "@/lib/api/favorite-api";
import type { FavoriteWithChat } from "@shared/types/favorite.types";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";

export interface UseFavoritesReturn {
  favorites: FavoriteWithChat[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  add: (chatId: string) => Promise<void>;
  remove: (chatId: string) => Promise<void>;
  isFavorite: (chatId: string) => boolean;
  reorder: (favoriteId: string, newSortOrder: number) => Promise<void>;
}

export function useFavorites(): UseFavoritesReturn {
  const [favorites, setFavorites] = useState<FavoriteWithChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isReady } = useBackendURL();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const fetchFavorites = useCallback(async () => {
    if (!isReady || !activeWorkspaceId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await listFavorites(activeWorkspaceId);
      setFavorites(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load favorites");
      console.error("Error fetching favorites:", err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, isReady]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const add = useCallback(
    async (chatId: string) => {
      if (!activeWorkspaceId) return;
      try {
        const newFav = await addFavorite(activeWorkspaceId, chatId);
        setFavorites((prev) => [...prev, newFav]);
      } catch (err) {
        console.error("Error adding favorite:", err);
        throw err;
      }
    },
    [activeWorkspaceId],
  );

  const remove = useCallback(async (chatId: string) => {
    try {
      await removeFavoriteByChat(chatId);
      setFavorites((prev) => prev.filter((f) => f.chatId !== chatId));
    } catch (err) {
      console.error("Error removing favorite:", err);
      throw err;
    }
  }, []);

  const isFavorite = useCallback(
    (chatId: string) => favorites.some((f) => f.chatId === chatId),
    [favorites],
  );

  const reorder = useCallback(
    async (favoriteId: string, newSortOrder: number) => {
      try {
        // Optimistic update
        setFavorites((prev) => {
          const updated = prev.map((f) =>
            f.id === favoriteId ? { ...f, sortOrder: newSortOrder } : f,
          );
          return updated.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        });
        await updateFavoriteSortOrder(favoriteId, newSortOrder);
      } catch (err) {
        console.error("Error reordering favorite:", err);
        // Revert on error
        fetchFavorites();
        throw err;
      }
    },
    [fetchFavorites],
  );

  return {
    favorites,
    loading,
    error,
    refetch: fetchFavorites,
    add,
    remove,
    isFavorite,
    reorder,
  };
}
