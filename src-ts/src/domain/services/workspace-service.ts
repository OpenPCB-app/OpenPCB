import type { DatabaseAccess } from '../../db';
import type { Workspace, WorkspaceSettings } from '../../db/schema/workspace';
import { NotFoundError, ValidationError } from '../../core/errors';

/**
 * Workspace creation input
 */
export interface CreateWorkspaceInput {
    name: string;
    settings?: WorkspaceSettings;
}

/**
 * Workspace update input
 */
export interface UpdateWorkspaceInput {
    name?: string;
    settings?: WorkspaceSettings;
}

/**
 * WorkspaceService interface
 */
export interface IWorkspaceService {
    list(): Promise<Workspace[]>;
    get(id: string): Promise<Workspace>;
    create(input: CreateWorkspaceInput): Promise<Workspace>;
    update(id: string, input: UpdateWorkspaceInput): Promise<Workspace>;
    delete(id: string): Promise<void>;
}

/**
 * WorkspaceService - Workspace business logic
 */
export class WorkspaceService implements IWorkspaceService {
    constructor(private db: DatabaseAccess) { }

    /**
     * List all active workspaces
     */
    async list(): Promise<Workspace[]> {
        return this.db.workspaces.findActive();
    }

    /**
     * Get workspace by ID
     * @throws NotFoundError if workspace doesn't exist
     */
    async get(id: string): Promise<Workspace> {
        const workspace = await this.db.workspaces.findById(id);
        if (!workspace) {
            throw new NotFoundError('Workspace', id);
        }
        return workspace;
    }

    /**
     * Create new workspace
     * @throws ValidationError if name missing
     */
    async create(input: CreateWorkspaceInput): Promise<Workspace> {
        if (!input.name || input.name.trim() === '') {
            throw new ValidationError('Workspace name is required');
        }

        return this.db.workspaces.create({
            name: input.name.trim(),
            settings: input.settings,
        });
    }

    /**
     * Update existing workspace
     * @throws NotFoundError if workspace doesn't exist
     */
    async update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
        // Verify exists
        await this.get(id);

        // Validate name if provided
        if (input.name !== undefined && input.name.trim() === '') {
            throw new ValidationError('Workspace name cannot be empty');
        }

        const updateData: Partial<UpdateWorkspaceInput> = {};
        if (input.name) updateData.name = input.name.trim();
        if (input.settings !== undefined) updateData.settings = input.settings;

        return this.db.workspaces.update(id, updateData);
    }

    /**
     * Soft delete workspace
     * @throws NotFoundError if workspace doesn't exist
     */
    async delete(id: string): Promise<void> {
        // Verify exists
        await this.get(id);

        await this.db.workspaces.softDelete(id);
    }
}
