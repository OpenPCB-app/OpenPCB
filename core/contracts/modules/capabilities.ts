export interface ProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ProjectsCapability {
  list(input: { workspaceId: string; status?: "active" | "archived" | "all" }): Promise<ProjectSummary[]>;
  get(input: { workspaceId: string; projectId: string }): Promise<ProjectSummary | null>;
}
