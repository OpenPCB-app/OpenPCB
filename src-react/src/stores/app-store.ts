import { create } from "zustand";
import type { WorkspaceRecord, CreateWorkspaceInput, UpdateWorkspaceInput } from "@shared/types/workspace.types";
import type { ProjectRecord } from "@shared/types/project.types";
import { CoreSDK } from "@shared/sdk";

interface AppState {
    workspaces: WorkspaceRecord[];
    projects: ProjectRecord[];
    activeWorkspaceId: string | null;
    activeProjectId: string | null;
    isLoading: boolean;
    error: string | null;
    isInitialized: boolean;

    setWorkspaces: (workspaces: WorkspaceRecord[]) => void;
    setProjects: (projects: ProjectRecord[]) => void;
    setActiveWorkspace: (id: string) => void;
    setActiveProject: (id: string) => void;
    fetchInitialState: () => Promise<void>;

    // Workspace CRUD operations
    createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceRecord>;
    updateWorkspace: (id: string, input: UpdateWorkspaceInput) => Promise<WorkspaceRecord>;
    deleteWorkspace: (id: string) => Promise<void>;
    refetchWorkspaces: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
    workspaces: [],
    projects: [],
    activeWorkspaceId: null,
    activeProjectId: null,
    isLoading: false,
    error: null,
    isInitialized: false,

    setWorkspaces: (workspaces) => set({ workspaces }),
    setProjects: (projects) => set({ projects }),
    setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
    setActiveProject: (id) => set({ activeProjectId: id }),

    fetchInitialState: async () => {
        set({ isLoading: true, error: null });
        try {
            // Wait for backend to be ready (health check)
            let attempts = 0;
            const maxAttempts = 20; // 20 seconds max
            while (attempts < maxAttempts) {
                const isHealthy = await CoreSDK.health();
                if (isHealthy) break;
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }

            if (attempts >= maxAttempts) {
                throw new Error("Backend server is not reachable. Please check if 'npm run dev' is running.");
            }

            // Fetch workspaces
            const workspaces = await CoreSDK.workspaces.list();

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
                    projects = await CoreSDK.projects.list(activeWorkspaceId);
                } catch (e) {
                    console.error("Failed to fetch projects for workspace", activeWorkspaceId, e);
                    // Don't kill the entire init if project fetch fails
                }
            }

            set({
                workspaces,
                projects,
                activeWorkspaceId,
                isInitialized: true,
                isLoading: false,
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

    createWorkspace: async (input: CreateWorkspaceInput) => {
        const newWorkspace = await CoreSDK.workspaces.create(input);
        const workspaces = [...get().workspaces, newWorkspace];
        set({ workspaces });
        return newWorkspace;
    },

    updateWorkspace: async (id: string, input: UpdateWorkspaceInput) => {
        const updatedWorkspace = await CoreSDK.workspaces.update(id, input);
        const workspaces = get().workspaces.map(w =>
            w.id === id ? updatedWorkspace : w
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

        await CoreSDK.workspaces.delete(id);

        // Remove from local state
        const updatedWorkspaces = workspaces.filter(w => w.id !== id);

        // If deleting active workspace, switch to first remaining
        let newActiveId = activeWorkspaceId;
        if (activeWorkspaceId === id) {
            newActiveId = updatedWorkspaces[0]?.id || null;
        }

        set({
            workspaces: updatedWorkspaces,
            activeWorkspaceId: newActiveId
        });

        // Fetch projects for new active workspace
        if (newActiveId && newActiveId !== activeWorkspaceId) {
            try {
                const projects = await CoreSDK.projects.list(newActiveId);
                set({ projects });
            } catch (e) {
                console.error("Failed to fetch projects after workspace switch:", e);
            }
        }
    },

    refetchWorkspaces: async () => {
        const workspaces = await CoreSDK.workspaces.list();
        set({ workspaces });
    },
}));
