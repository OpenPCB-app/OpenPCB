import { useState, useEffect, useCallback } from "react";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from "@/lib/api/project-api";
import { ProjectRecord, UpdateProjectInput } from "@shared/types";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";

export interface UseProjectsReturn {
  projects: ProjectRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (
    name: string,
    description?: string,
    icon?: string,
    color?: string,
  ) => Promise<ProjectRecord>;
  update: (id: string, updates: UpdateProjectInput) => Promise<ProjectRecord>;
  remove: (id: string) => Promise<void>;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isReady } = useBackendURL();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const fetchProjects = useCallback(async () => {
    if (!isReady || !activeWorkspaceId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await listProjects(activeWorkspaceId);
      setProjects(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
      console.error("Error fetching projects:", err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, isReady]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const create = useCallback(
    async (
      name: string,
      description?: string,
      icon?: string,
      color?: string,
    ) => {
      if (!activeWorkspaceId) throw new Error("No active workspace");
      const newProject = await createProject(
        activeWorkspaceId,
        name,
        description,
        icon,
        color,
      );
      setProjects((prev) => [...prev, newProject]);
      return newProject;
    },
    [activeWorkspaceId],
  );

  const update = useCallback(
    async (id: string, updates: UpdateProjectInput) => {
      const updatedProject = await updateProject(id, updates);
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? updatedProject : p)),
      );
      return updatedProject;
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return {
    projects,
    loading,
    error,
    refetch: fetchProjects,
    create,
    update,
    remove,
  };
}
