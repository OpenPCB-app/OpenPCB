import { useState, useEffect, useCallback } from "react";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";
import type {
  TagRecord,
  CreateTagInput,
  UpdateTagInput,
} from "@shared/types/tag.types";

export interface UseTagsReturn {
  tags: TagRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createTag: (
    input: Omit<CreateTagInput, "workspaceId"> & { workspaceId?: string },
  ) => Promise<TagRecord>;
  updateTag: (id: string, input: UpdateTagInput) => Promise<TagRecord>;
  deleteTag: (id: string) => Promise<void>;
  addTagToChat: (chatId: string, tagId: string) => Promise<void>;
  removeTagFromChat: (chatId: string, tagId: string) => Promise<void>;
  getChatTags: (chatId: string) => Promise<TagRecord[]>;
}

export function useTags(projectId?: string | null): UseTagsReturn {
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { backendURL, isReady } = useBackendURL();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const fetchTags = useCallback(async () => {
    if (!isReady || !backendURL || !activeWorkspaceId) return;

    try {
      setLoading(true);
      setError(null);

      const url = new URL(`${backendURL}/api/tags`);
      url.searchParams.append("workspaceId", activeWorkspaceId);
      if (projectId) {
        url.searchParams.append("projectId", projectId);
      }

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch tags");

      const json = await res.json();
      setTags(json.data || json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tags");
      console.error("Error fetching tags:", err);
    } finally {
      setLoading(false);
    }
  }, [backendURL, isReady, activeWorkspaceId, projectId]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const createTag = async (
    input: Omit<CreateTagInput, "workspaceId"> & { workspaceId?: string },
  ): Promise<TagRecord> => {
    if (!backendURL) throw new Error("Backend not ready");
    if (!input.workspaceId && !activeWorkspaceId)
      throw new Error("No workspace ID provided");

    const finalInput = {
      ...input,
      workspaceId: input.workspaceId || activeWorkspaceId!,
    };

    const res = await fetch(`${backendURL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalInput),
    });

    if (!res.ok) throw new Error("Failed to create tag");

    const newTag = await res.json();
    setTags((prev) => [...prev, newTag]);
    return newTag;
  };

  const updateTag = async (
    id: string,
    input: UpdateTagInput,
  ): Promise<TagRecord> => {
    if (!backendURL) throw new Error("Backend not ready");

    const res = await fetch(`${backendURL}/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) throw new Error("Failed to update tag");

    const updatedTag = await res.json();
    setTags((prev) => prev.map((t) => (t.id === id ? updatedTag : t)));
    return updatedTag;
  };

  const deleteTag = async (id: string): Promise<void> => {
    if (!backendURL) throw new Error("Backend not ready");

    const res = await fetch(`${backendURL}/api/tags/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) throw new Error("Failed to delete tag");

    setTags((prev) => prev.filter((t) => t.id !== id));
  };

  const addTagToChat = async (chatId: string, tagId: string): Promise<void> => {
    if (!backendURL) throw new Error("Backend not ready");

    const res = await fetch(`${backendURL}/api/chats/${chatId}/tags/${tagId}`, {
      method: "POST",
    });

    if (!res.ok) throw new Error("Failed to add tag to chat");
  };

  const removeTagFromChat = async (
    chatId: string,
    tagId: string,
  ): Promise<void> => {
    if (!backendURL) throw new Error("Backend not ready");

    const res = await fetch(`${backendURL}/api/chats/${chatId}/tags/${tagId}`, {
      method: "DELETE",
    });

    if (!res.ok) throw new Error("Failed to remove tag from chat");
  };

  const getChatTags = async (chatId: string): Promise<TagRecord[]> => {
    if (!backendURL) throw new Error("Backend not ready");

    const res = await fetch(`${backendURL}/api/chats/${chatId}/tags`);
    if (!res.ok) throw new Error("Failed to fetch chat tags");

    return res.json();
  };

  return {
    tags,
    loading,
    error,
    refetch: fetchTags,
    createTag,
    updateTag,
    deleteTag,
    addTagToChat,
    removeTagFromChat,
    getChatTags,
  };
}
