import type { DatabaseAccess } from "../../db";
import type { Design } from "../../db/schema/design";
import { NotFoundError, ValidationError } from "../../core/errors";
import type {
  CreateDesignInput,
  UpdateDesignInput,
} from "@shared/types/design.types";

export interface IDesignService {
  listByScope(workspaceId: string, projectId: string | null): Promise<Design[]>;
  listByProject(projectId: string): Promise<Design[]>;
  get(id: string): Promise<Design>;
  create(input: CreateDesignInput): Promise<Design>;
  update(id: string, input: UpdateDesignInput): Promise<Design>;
  delete(id: string): Promise<void>;
}

export class DesignService implements IDesignService {
  constructor(private db: DatabaseAccess) {}

  async listByScope(
    workspaceId: string,
    projectId: string | null,
  ): Promise<Design[]> {
    return this.db.designs.findByScope(workspaceId, projectId);
  }

  async listByProject(projectId: string): Promise<Design[]> {
    const project = await this.db.projects.findById(projectId);
    if (!project || project.deletedAt) {
      throw new NotFoundError("Project", projectId);
    }
    return this.db.designs.findByScope(project.workspaceId, projectId);
  }

  async get(id: string): Promise<Design> {
    const design = await this.db.designs.findById(id);
    if (!design || design.deletedAt) {
      throw new NotFoundError("Design", id);
    }
    return design;
  }

  async create(input: CreateDesignInput): Promise<Design> {
    if (!input.name || input.name.trim() === "") {
      throw new ValidationError("Design name is required");
    }

    const workspace = await this.db.workspaces.findById(input.workspaceId);
    if (!workspace) {
      throw new NotFoundError("Workspace", input.workspaceId);
    }

    if (input.projectId) {
      const project = await this.db.projects.findById(input.projectId);
      if (!project || project.deletedAt) {
        throw new NotFoundError("Project", input.projectId);
      }

      if (project.workspaceId !== input.workspaceId) {
        throw new ValidationError("Design workspace must match project workspace");
      }
    }

    return this.db.designs.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      sortOrder: input.sortOrder ?? null,
    });
  }

  async update(id: string, input: UpdateDesignInput): Promise<Design> {
    await this.get(id);

    if (input.name !== undefined && input.name.trim() === "") {
      throw new ValidationError("Design name cannot be empty");
    }

    return this.db.designs.update(id, {
      ...input,
      name: input.name !== undefined ? input.name.trim() : undefined,
    });
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.db.designs.softDelete(id);
  }
}
