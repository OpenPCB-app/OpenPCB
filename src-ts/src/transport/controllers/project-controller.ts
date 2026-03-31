import type { RouteContext } from '../router';
import type { IProjectService } from '../../domain/services/project-service';
import { ResponseBuilder } from '../../core/utils/response-builder';

/**
 * ProjectController - HTTP handler for projects
 */
export class ProjectController {
    constructor(private projectService: IProjectService) { }

    /**
     * GET /api/projects
     * Query params: workspaceId (required)
     */
    async list(ctx: RouteContext): Promise<Response> {
        const url = new URL(ctx.req.url);
        const workspaceId = url.searchParams.get('workspaceId');
        const status = url.searchParams.get('status') ?? 'active';

        if (!workspaceId) {
            return ResponseBuilder.badRequest('Missing workspaceId query parameter');
        }

        if (!["active", "archived", "all"].includes(status)) {
            return ResponseBuilder.badRequest("Invalid status query parameter");
        }

        const projects = await this.projectService.list(
            workspaceId,
            status as "active" | "archived" | "all",
        );
        return ResponseBuilder.success({ projects });
    }

    /**
     * GET /api/projects/:id
     */
    async get(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        const project = await this.projectService.get(id);
        return ResponseBuilder.success({ project });
    }

    /**
     * POST /api/projects
     */
    async create(ctx: RouteContext): Promise<Response> {
        const body = await ctx.req.json();
        const project = await this.projectService.create(body);
        return ResponseBuilder.created({ project });
    }

    /**
     * PATCH /api/projects/:id
     */
    async update(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        const body = await ctx.req.json();
        const project = await this.projectService.update(id, body);
        return ResponseBuilder.success({ project });
    }

    /**
     * DELETE /api/projects/:id
     */
    async delete(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        await this.projectService.delete(id);
        return ResponseBuilder.success({ deleted: true });
    }
}
