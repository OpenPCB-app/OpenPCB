import { useState, useEffect, useCallback } from "react";
import {
  listBookmarks,
  createBookmark,
  removeBookmark,
  removeBookmarkByMessage,
  updateBookmarkNote,
} from "@/lib/api/bookmark-api";
import type { BookmarkWithMessage } from "@shared/types/bookmark.types";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";

export interface UseBookmarksReturn {
  bookmarks: BookmarkWithMessage[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  add: (messageId: string, chatId: string, note?: string) => Promise<void>;
  remove: (bookmarkId: string) => Promise<void>;
  removeByMessage: (messageId: string) => Promise<void>;
  updateNote: (bookmarkId: string, note: string | null) => Promise<void>;
  isBookmarked: (messageId: string) => boolean;
}

export function useBookmarks(): UseBookmarksReturn {
  const [bookmarks, setBookmarks] = useState<BookmarkWithMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isReady } = useBackendURL();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const fetchBookmarks = useCallback(async () => {
    if (!isReady || !activeWorkspaceId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await listBookmarks(activeWorkspaceId);
      setBookmarks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bookmarks");
      console.error("Error fetching bookmarks:", err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, isReady]);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  const add = useCallback(
    async (messageId: string, chatId: string, note?: string) => {
      if (!activeWorkspaceId) return;
      try {
        await createBookmark({
          workspaceId: activeWorkspaceId,
          messageId,
          chatId,
          note,
        });
        await fetchBookmarks();
      } catch (err) {
        console.error("Error adding bookmark:", err);
        throw err;
      }
    },
    [activeWorkspaceId, fetchBookmarks],
  );

  const remove = useCallback(async (bookmarkId: string) => {
    try {
      await removeBookmark(bookmarkId);
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
    } catch (err) {
      console.error("Error removing bookmark:", err);
      throw err;
    }
  }, []);

  const removeByMessage = useCallback(async (messageId: string) => {
    try {
      await removeBookmarkByMessage(messageId);
      setBookmarks((prev) => prev.filter((b) => b.messageId !== messageId));
    } catch (err) {
      console.error("Error removing bookmark by message:", err);
      throw err;
    }
  }, []);

  const updateNote = useCallback(
    async (bookmarkId: string, note: string | null) => {
      try {
        const updated = await updateBookmarkNote(bookmarkId, note);
        setBookmarks((prev) =>
          prev.map((b) =>
            b.id === bookmarkId ? { ...b, note: updated.note } : b,
          ),
        );
      } catch (err) {
        console.error("Error updating bookmark note:", err);
        throw err;
      }
    },
    [],
  );

  const isBookmarked = useCallback(
    (messageId: string) => bookmarks.some((b) => b.messageId === messageId),
    [bookmarks],
  );

  return {
    bookmarks,
    loading,
    error,
    refetch: fetchBookmarks,
    add,
    remove,
    removeByMessage,
    updateNote,
    isBookmarked,
  };
}
