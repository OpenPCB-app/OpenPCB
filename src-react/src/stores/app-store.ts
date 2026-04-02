import { create } from "zustand";
import type {
  WorkspaceRecord,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from "@shared/types/workspace.types";
import type { ProjectRecord } from "@shared/types/project.types";
import type {
  CreateDesignInput,
  DesignRecord,
  UpdateDesignInput,
} from "@shared/types/design.types";
import {
  checkHealth,
  listWorkspaces as listWorkspacesRequest,
  createWorkspace as createWorkspaceRequest,
  updateWorkspace as updateWorkspaceRequest,
  deleteWorkspace as deleteWorkspaceRequest,
} from "@/lib/api/workspace-api";
import {
  createProject as createProjectRequest,
  deleteProject as deleteProjectRequest,
  listProjects as listProjectsRequest,
  updateProject as updateProjectRequest,
} from "@/lib/api/project-api";
import {
  createDesign as createDesignRequest,
  deleteDesign as deleteDesignRequest,
  listDesigns as listDesignsRequest,
  updateDesign as updateDesignRequest,
  type DesignScope,
} from "@/lib/api/design-api";
import type { UpdateProjectInput } from "@shared/types";

function getDesignScopeKey(
  workspaceId: string,
  projectId?: string | null,
): string {
  return projectId ? `project:${projectId}` : `workspace:${workspaceId}`;
}

interface AppState {
  workspaces: WorkspaceRecord[];
  projects: ProjectRecord[];
  designsByScope: Record<string, DesignRecord[]>;
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
  projectsLoading: boolean;
  projectsError: string | null;

  setWorkspaces: (workspaces: WorkspaceRecord[]) => void;
  setProjects: (projects: ProjectRecord[]) => void;
  setActiveWorkspace: (id: string) => void;
  setActiveProject: (id: string) => void;
  fetchInitialState: () => Promise<void>;
  fetchProjects: (workspaceId?: string | null) => Promise<void>;
  createProject: (input: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
  }) => Promise<ProjectRecord>;
  updateProject: (
    id: string,
    input: UpdateProjectInput,
  ) => Promise<ProjectRecord>;
  deleteProject: (id: string) => Promise<void>;
  fetchDesigns: (scope: DesignScope) => Promise<DesignRecord[]>;
  createDesign: (input: CreateDesignInput) => Promise<DesignRecord>;
  updateDesign: (id: string, input: UpdateDesignInput) => Promise<DesignRecord>;
  deleteDesign: (id: string) => Promise<void>;

  // Workspace CRUD operations
  createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceRecord>;
  updateWorkspace: (
    id: string,
    input: UpdateWorkspaceInput,
  ) => Promise<WorkspaceRecord>;
  deleteWorkspace: (id: string) => Promise<void>;
  refetchWorkspaces: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  workspaces: [],
  projects: [],
  designsByScope: {},
  activeWorkspaceId: null,
  activeProjectId: null,
  isLoading: false,
  error: null,
  isInitialized: false,
  projectsLoading: false,
  projectsError: null,

  setWorkspaces: (workspaces) => set({ workspaces }),
  setProjects: (projects) => set({ projects }),
  setActiveWorkspace: (id) =>
    set({
      activeWorkspaceId: id,
      activeProjectId: null,
      projects: [],
      designsByScope: {},
      projectsError: null,
    }),
  setActiveProject: (id) => set({ activeProjectId: id }),

  fetchInitialState: async () => {
    set({ isLoading: true, error: null });
    try {
      // Wait for backend to be ready (health check)
      let attempts = 0;
      const maxAttempts = 20; // 20 seconds max
      while (attempts < maxAttempts) {
        const isHealthy = await checkHealth();
        if (isHealthy) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }

      if (attempts >= maxAttempts) {
        throw new Error(
          "Backend server is not reachable. Please check if 'npm run dev' is running.",
        );
      }

      // Fetch workspaces
      const workspaces = await listWorkspacesRequest();

      let projects: ProjectRecord[] = [];
      let activeWorkspaceId = get().activeWorkspaceId;

      // Select default workspace if none active
      if (!activeWorkspaceId && workspaces.length > 0) {
        // Use first workspace if available
        const first = workspaces[0];
        activeWorkspaceId = first ? first.id : null;
      }

      // If we have an active workspace (either pre-existing or just selected), fetch its projects
      if (activeWorkspaceId) {
        try {
          projects = await listProjectsRequest(activeWorkspaceId);
        } catch (e) {
          console.error(
            "Failed to fetch projects for workspace",
            activeWorkspaceId,
            e,
          );
          // Don't kill the entire init if project fetch fails
        }
      }

      set({
        workspaces,
        projects,
        designsByScope: {},
        activeWorkspaceId,
        isInitialized: true,
        isLoading: false,
        projectsLoading: false,
        projectsError: null,
      });
    } catch (err) {
      console.error("Failed to initialize app state:", err);
      set({
        error: (err as Error).message,
        isLoading: false,
        isInitialized: true, // Mark as initialized even on error to stop loading spinner loops if persistent
      });
    }
  },

  fetchProjects: async (workspaceId) => {
    const targetWorkspaceId = workspaceId ?? get().activeWorkspaceId;
    if (!targetWorkspaceId) {
      set({
        projects: [],
        designsByScope: {},
        projectsLoading: false,
        projectsError: null,
      });
      return;
    }

    set({ projectsLoading: true, projectsError: null });
    try {
      const projects = await listProjectsRequest(targetWorkspaceId);
      set({
        projects,
        designsByScope: {},
        projectsLoading: false,
        projectsError: null,
      });
    } catch (err) {
      set({
        projectsLoading: false,
        projectsError:
          err instanceof Error ? err.message : "Failed to load projects",
      });
    }
  },

  createProject: async (input) => {
    const activeWorkspaceId = get().activeWorkspaceId;
    if (!activeWorkspaceId) {
      throw new Error("No active workspace");
    }

    const project = await createProjectRequest(
      activeWorkspaceId,
      input.name,
      input.description,
      input.icon,
      input.color,
    );
    set((state) => ({
      projects: [...state.projects, project].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    }));
    return project;
  },

  updateProject: async (id, input) => {
    const updatedProject = await updateProjectRequest(id, input);
    set((state) => ({
      projects: state.projects
        .map((project) => (project.id === id ? updatedProject : project))
        .filter((project) => project.status === "active" && !project.deletedAt)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
    return updatedProject;
  },

  deleteProject: async (id) => {
    await deleteProjectRequest(id);
    set((state) => {
      const nextDesigns = { ...state.designsByScope };
      delete nextDesigns[getDesignScopeKey(state.activeWorkspaceId ?? "", id)];
      return {
        projects: state.projects.filter((project) => project.id !== id),
        designsByScope: nextDesigns,
        activeProjectId:
          state.activeProjectId === id ? null : state.activeProjectId,
      };
    });
  },

  fetchDesigns: async (scope) => {
    const designs = await listDesignsRequest(scope);
    set((state) => ({
      designsByScope: {
        ...state.designsByScope,
        [getDesignScopeKey(scope.workspaceId, scope.projectId)]: designs,
      },
    }));
    return designs;
  },

  createDesign: async (input) => {
    const design = await createDesignRequest(input);
    const scopeKey = getDesignScopeKey(design.workspaceId, design.projectId);
    set((state) => ({
      designsByScope: {
        ...state.designsByScope,
        [scopeKey]: [...(state.designsByScope[scopeKey] ?? []), design].sort(
          (a, b) =>
            (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
            a.name.localeCompare(b.name),
        ),
      },
    }));
    return design;
  },

  updateDesign: async (id, input) => {
    const design = await updateDesignRequest(id, input);
    set((state) => ({
      designsByScope: Object.fromEntries(
        Object.entries(state.designsByScope).map(([scopeKey, designs]) => [
          scopeKey,
          designs
            .map((item) => (item.id === id ? design : item))
            .sort(
              (a, b) =>
                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                a.name.localeCompare(b.name),
            ),
        ]),
      ),
    }));
    return design;
  },

  deleteDesign: async (id) => {
    await deleteDesignRequest(id);
    set((state) => ({
      designsByScope: Object.fromEntries(
        Object.entries(state.designsByScope).map(([scopeKey, designs]) => [
          scopeKey,
          designs.filter((design) => design.id !== id),
        ]),
      ),
    }));
  },

  createWorkspace: async (input: CreateWorkspaceInput) => {
    const newWorkspace = await createWorkspaceRequest(input);
    const workspaces = [...get().workspaces, newWorkspace];
    set({ workspaces });
    return newWorkspace;
  },

  updateWorkspace: async (id: string, input: UpdateWorkspaceInput) => {
    const updatedWorkspace = await updateWorkspaceRequest(id, input);
    const workspaces = get().workspaces.map((w) =>
      w.id === id ? updatedWorkspace : w,
    );
    set({ workspaces });
    return updatedWorkspace;
  },

  deleteWorkspace: async (id: string) => {
    const { workspaces, activeWorkspaceId } = get();

    // Validation: prevent deleting last workspace
    if (workspaces.length <= 1) {
      throw new Error("Cannot delete the last workspace");
    }

    await deleteWorkspaceRequest(id);

    // Remove from local state
    const updatedWorkspaces = workspaces.filter((w) => w.id !== id);

    // If deleting active workspace, switch to first remaining
    let newActiveId = activeWorkspaceId;
    if (activeWorkspaceId === id) {
      newActiveId = updatedWorkspaces[0]?.id || null;
    }

    set({
      workspaces: updatedWorkspaces,
      activeWorkspaceId: newActiveId,
      activeProjectId: activeWorkspaceId === id ? null : get().activeProjectId,
    });

    // Fetch projects for new active workspace
    if (newActiveId && newActiveId !== activeWorkspaceId) {
      try {
        const projects = await listProjectsRequest(newActiveId);
        set({ projects, designsByScope: {} });
      } catch (e) {
        console.error("Failed to fetch projects after workspace switch:", e);
      }
    }
  },

  refetchWorkspaces: async () => {
    const workspaces = await listWorkspacesRequest();
    set({ workspaces });
  },
}));
