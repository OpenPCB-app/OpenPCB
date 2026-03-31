import type { DatabaseAccess } from '../../db';
import type { Project } from '../../db/schema/project';
import { NotFoundError, ValidationError } from '../../core/errors';
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from '@shared/types/project.types';

/**
 * ProjectService interface
 */
export interface IProjectService {
  list(workspaceId: string): Promise<Project[]>;
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

  async list(workspaceId: string): Promise<Project[]> {
    return this.db.projects.findActiveByWorkspace(workspaceId);
  }

  async get(id: string): Promise<Project> {
    const project = await this.db.projects.findById(id);
    if (!project) {
      throw new NotFoundError('Project', id);
    }
    return project;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    if (!input.name || input.name.trim() === '') {
      throw new ValidationError('Project name is required');
    }

    const workspace = await this.db.workspaces.findById(input.workspaceId);
    if (!workspace) {
      throw new NotFoundError('Workspace', input.workspaceId);
    }

    return this.db.projects.create({
      ...input,
      name: input.name.trim(),
      status: input.status ?? 'active',
    });
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const project = await this.get(id);

    if (input.name !== undefined && input.name.trim() === '') {
      throw new ValidationError('Project name cannot be empty');
    }

    const updateData: any = { ...input };
    if (input.name) updateData.name = input.name.trim();

    if (input.aiConfig !== undefined) {
      updateData.aiConfig = this.mergeConfig(
        project.aiConfig || {},
        input.aiConfig
      );
    }

    if (input.ragConfig !== undefined) {
      updateData.ragConfig = this.mergeConfig(
        project.ragConfig || {},
        input.ragConfig
      );
    }

    if (input.preferences !== undefined) {
      updateData.preferences = this.mergeConfig(
        project.preferences || {},
        input.preferences
      );
    }

    if (input.metadata !== undefined) {
      updateData.metadata = this.mergeConfig(
        project.metadata || {},
        input.metadata
      );
    }

    return this.db.projects.update(id, updateData);
  }

  async delete(id: string): Promise<void> {
    await this.get(id);

    await this.db.projects.softDelete(id);
  }

  private mergeConfig<T>(existing: T, incoming: T | null): T | null {
    if (incoming === null) return null;
    if (typeof existing !== 'object' || typeof incoming !== 'object')
      return incoming;
    return { ...existing, ...incoming };
  }
}
