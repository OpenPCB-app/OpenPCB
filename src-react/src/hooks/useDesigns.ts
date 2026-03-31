import { useEffect } from "react";
import type { CreateDesignInput, DesignRecord, UpdateDesignInput } from "@shared/types";
import { useAppStore } from "@/stores/app-store";

const EMPTY_DESIGNS: DesignRecord[] = [];
function getDesignScopeKey(workspaceId: string, projectId?: string | null): string {
  return projectId ? `project:${projectId}` : `workspace:${workspaceId}`;
}

export interface UseDesignsReturn {
  designs: DesignRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<DesignRecord[]>;
  create: (
    input: Omit<CreateDesignInput, "workspaceId" | "projectId">,
  ) => Promise<DesignRecord>;
  update: (id: string, input: UpdateDesignInput) => Promise<DesignRecord>;
  remove: (id: string) => Promise<void>;
}

export function useDesigns({
  workspaceId,
  projectId,
}: {
  workspaceId: string | null;
  projectId?: string | null;
}): UseDesignsReturn {
  const scopeKey = workspaceId ? getDesignScopeKey(workspaceId, projectId) : null;
  const designs = useAppStore((state) =>
    scopeKey ? state.designsByScope[scopeKey] ?? EMPTY_DESIGNS : EMPTY_DESIGNS,
  );
  const fetchDesigns = useAppStore((state) => state.fetchDesigns);
  const createDesign = useAppStore((state) => state.createDesign);
  const updateDesign = useAppStore((state) => state.updateDesign);
  const deleteDesign = useAppStore((state) => state.deleteDesign);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchDesigns({ workspaceId, projectId: projectId ?? null });
  }, [fetchDesigns, projectId, workspaceId]);

  return {
    designs,
    loading: false,
    error: null,
    refetch: async () => {
      if (!workspaceId) return [];
      return fetchDesigns({ workspaceId, projectId: projectId ?? null });
    },
    create: async (input) => {
      if (!workspaceId) {
        throw new Error("No workspace selected");
      }
      return createDesign({
        workspaceId,
        projectId: projectId ?? null,
        ...input,
      });
    },
    update: updateDesign,
    remove: deleteDesign,
  };
}
