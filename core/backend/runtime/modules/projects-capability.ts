import type { ProjectSummary, ProjectsCapability } from "../../../contracts/modules/capabilities";

const EMPTY_PROJECTS: ProjectSummary[] = [];

export class CoreProjectsCapability implements ProjectsCapability {
  async list(_input: {
    workspaceId: string;
    status?: "active" | "archived" | "all";
  }): Promise<ProjectSummary[]> {
    return EMPTY_PROJECTS;
  }

  async get(_input: { workspaceId: string; projectId: string }): Promise<ProjectSummary | null> {
    return null;
  }
}
