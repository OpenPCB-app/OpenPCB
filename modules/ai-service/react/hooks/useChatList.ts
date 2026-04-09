/**
 * useChatList Hook
 *
 * Manages fetching and displaying the list of chats
 * Automatically reacts to workspace changes via zustand store
 */

import { useState, useEffect, useCallback } from "react";
import { listChats } from "@/lib/api/chat-api";
import type { ChatMetadata } from "@shared/types";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";

export interface UseChatListOptions {
  limit?: number;
  folderId?: string | null;
  projectId?: string | null;
}

export interface UseChatListReturn {
  chats: ChatMetadata[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useChatList(options?: UseChatListOptions): UseChatListReturn {
  const [chats, setChats] = useState<ChatMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isReady } = useBackendURL();

  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const fetchChats = useCallback(async () => {
    if (!isReady || !activeWorkspaceId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await listChats(
        activeWorkspaceId,
        options?.limit,
        options?.folderId,
        ["brainstorming_node", "knowledge_page", "writer_document"],
        options?.projectId === undefined ? null : options.projectId,
      );
      setChats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chats");
      console.error("Error fetching chats:", err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, options?.limit, options?.folderId, options?.projectId, isReady]);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  return {
    chats,
    loading,
    error,
    refetch: fetchChats,
  };
}
