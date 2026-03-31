import type { RouteContext } from '../router';
import type { IWorkspaceService } from '../../domain/services';
import { ResponseBuilder } from '../../core/utils/response-builder';

/**
 * WorkspaceController - Thin HTTP handler for workspaces
 * All business logic delegated to WorkspaceService
 */
export class WorkspaceController {
    constructor(private workspaceService: IWorkspaceService) { }

    /**
     * GET /api/workspaces
     */
    async list(_ctx: RouteContext): Promise<Response> {
        const workspaces = await this.workspaceService.list();
        return ResponseBuilder.success({ workspaces });
    }

    /**
     * GET /api/workspaces/:id
     */
    async get(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        const workspace = await this.workspaceService.get(id);
        return ResponseBuilder.success({ workspace });
    }

    /**
     * POST /api/workspaces
     */
    async create(ctx: RouteContext): Promise<Response> {
        const body = await ctx.req.json();
        const workspace = await this.workspaceService.create(body);
        return ResponseBuilder.created({ workspace });
    }

    /**
     * PATCH /api/workspaces/:id
     */
    async update(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        const body = await ctx.req.json();
        const workspace = await this.workspaceService.update(id, body);
        return ResponseBuilder.success({ workspace });
    }

    /**
     * DELETE /api/workspaces/:id
     */
    async delete(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        await this.workspaceService.delete(id);
        return ResponseBuilder.success({ deleted: true });
    }
}
