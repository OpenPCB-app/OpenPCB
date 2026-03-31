import type { DatabaseAccess } from "../../db";
import type { Project } from "../../db/schema/project";
import { NotFoundError, ValidationError } from "../../core/errors";
import { project as projectTable } from "../../db/schema/project";
import { design as designTable } from "../../db/schema/design";
import { chat as chatTable } from "../../db/schema/chat";
import { file as fileTable } from "../../db/schema/file";
import { PageRepository } from "../../../../modules/knowledge/ts/db/repositories/page-repository";
import { and, eq, isNull } from "drizzle-orm";
import type {
  CreateProjectInput,
  UpdateProjectInput,
  ProjectStatus,
} from "@shared/types/project.types";
import { normalizeProjectIconId } from "@shared/types/project.types";

export type ProjectListStatus = ProjectStatus | "all";

/**
 * ProjectService interface
 */
export interface IProjectService {
  list(workspaceId: string, status?: ProjectListStatus): Promise<Project[]>;
  get(id: string): Promise<Project>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, input: UpdateProjectInput): Promise<Project>;
  delete(id: string): Promise<void>;
}

/**
 * ProjectService - Project business logic
 */
export class ProjectService implements IProjectService {
  constructor(private db: DatabaseAccess) {}

  async list(
    workspaceId: string,
    status: ProjectListStatus = "active",
  ): Promise<Project[]> {
    if (status === "active") {
      return this.db.projects.findActiveByWorkspace(workspaceId);
    }

    const projects = await this.db.projects.findByWorkspace(workspaceId);
    if (status === "archived") {
      return projects.filter((item) => item.status === "archived");
    }

    return projects;
  }

  async get(id: string): Promise<Project> {
    const project = await this.db.projects.findById(id);
    if (!project || project.deletedAt) {
      throw new NotFoundError("Project", id);
    }
    return project;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    if (!input.name || input.name.trim() === "") {
      throw new ValidationError("Project name is required");
    }

    const workspace = await this.db.workspaces.findById(input.workspaceId);
    if (!workspace) {
      throw new NotFoundError("Workspace", input.workspaceId);
    }

    return this.db.projects.create({
      ...input,
      name: input.name.trim(),
      icon: normalizeProjectIconId(input.icon),
      status: input.status ?? "active",
      preferences: {
        showInSidebar: true,
        ...(input.preferences || {}),
      },
    });
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const project = await this.get(id);

    if (input.name !== undefined && input.name.trim() === "") {
      throw new ValidationError("Project name cannot be empty");
    }

    const updateData: any = { ...input };
    if (input.name) updateData.name = input.name.trim();
    if (input.icon !== undefined) {
      updateData.icon = normalizeProjectIconId(input.icon);
    }

    if (input.aiConfig !== undefined) {
      updateData.aiConfig = this.mergeConfig(
        project.aiConfig || {},
        input.aiConfig,
      );
    }

    if (input.ragConfig !== undefined) {
      updateData.ragConfig = this.mergeConfig(
        project.ragConfig || {},
        input.ragConfig,
      );
    }

    if (input.preferences !== undefined) {
      updateData.preferences = this.mergeConfig(
        project.preferences || {},
        input.preferences,
      );
    }

    if (input.metadata !== undefined) {
      updateData.metadata = this.mergeConfig(
        project.metadata || {},
        input.metadata,
      );
    }

    return this.db.projects.update(id, updateData);
  }

  async delete(id: string): Promise<void> {
    const project = await this.get(id);

    await this.db.transaction(async (tx) => {
      const client = tx.getClient();
      const now = new Date();

      await client
        .update(designTable)
        .set({ deletedAt: now, updatedAt: now } as never)
        .where(
          and(eq(designTable.projectId, id), isNull(designTable.deletedAt)),
        );

      await client
        .update(chatTable)
        .set({ projectId: null, updatedAt: now } as never)
        .where(and(eq(chatTable.projectId, id), isNull(chatTable.deletedAt)));

      await client
        .update(fileTable)
        .set({ projectId: null, updatedAt: now } as never)
        .where(eq(fileTable.projectId, id));

      const knowledgePages = new PageRepository(client as never);
      await knowledgePages.detachProjectPages(project.workspaceId, id);

      await client
        .update(projectTable)
        .set({ deletedAt: now, updatedAt: now } as never)
        .where(and(eq(projectTable.id, id), isNull(projectTable.deletedAt)));
    });
  }

  private mergeConfig<T>(existing: T, incoming: T | null): T | null {
    if (incoming === null) return null;
    if (typeof existing !== 'object' || typeof incoming !== 'object')
      return incoming;
    return { ...existing, ...incoming };
  }
}
