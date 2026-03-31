import { useState, useEffect, useCallback } from "react";
import {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
} from "@/lib/api/folder-api";
import type { FolderRecord } from "@shared/types";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";

export interface UseFoldersReturn {
  folders: FolderRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (name: string, sortOrder?: number) => Promise<FolderRecord>;
  rename: (id: string, name: string) => Promise<FolderRecord>;
  toggleExpanded: (id: string) => Promise<void>;
  remove: (
    id: string,
    action?: "move_to_root" | "delete_chats",
  ) => Promise<void>;
}

export function useFolders(): UseFoldersReturn {
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isReady } = useBackendURL();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const fetchFolders = useCallback(async () => {
    if (!isReady || !activeWorkspaceId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await listFolders(activeWorkspaceId);
      setFolders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load folders");
      console.error("Error fetching folders:", err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, isReady]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const create = useCallback(
    async (name: string, sortOrder?: number) => {
      if (!activeWorkspaceId) throw new Error("No active workspace");
      const newFolder = await createFolder(activeWorkspaceId, name, sortOrder);
      setFolders((prev) => [...prev, newFolder]);
      return newFolder;
    },
    [activeWorkspaceId],
  );

  const remove = useCallback(
    async (id: string, action?: "move_to_root" | "delete_chats") => {
      await deleteFolder(id, action);
      setFolders((prev) => prev.filter((f) => f.id !== id));
    },
    [],
  );

  const rename = useCallback(async (id: string, name: string) => {
    const updated = await updateFolder(id, { name });
    setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
    return updated;
  }, []);

  const toggleExpanded = useCallback(
    async (id: string) => {
      const folder = folders.find((f) => f.id === id);
      if (!folder) return;
      const updated = await updateFolder(id, {
        isExpanded: !folder.isExpanded,
      });
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
    },
    [folders],
  );

  return {
    folders,
    loading,
    error,
    refetch: fetchFolders,
    create,
    rename,
    toggleExpanded,
    remove,
  };
}
