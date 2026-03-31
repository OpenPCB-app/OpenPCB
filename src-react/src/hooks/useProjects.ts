import { ProjectRecord, UpdateProjectInput } from "@shared/types";
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
  const projects = useAppStore((state) => state.projects);
  const loading = useAppStore((state) => state.projectsLoading);
  const error = useAppStore((state) => state.projectsError);
  const fetchProjects = useAppStore((state) => state.fetchProjects);
  const createProject = useAppStore((state) => state.createProject);
  const updateProject = useAppStore((state) => state.updateProject);
  const deleteProject = useAppStore((state) => state.deleteProject);

  return {
    projects,
    loading,
    error,
    refetch: fetchProjects,
    create: (name, description, icon, color) =>
      createProject({ name, description, icon, color }),
    update: updateProject,
    remove: deleteProject,
  };
}
