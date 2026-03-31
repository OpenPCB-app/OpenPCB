import type { RouteContext } from "../router";
import type { IDesignService } from "../../domain/services/design-service";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class DesignController {
  constructor(private designService: IDesignService) {}

  async list(ctx: RouteContext): Promise<Response> {
    const workspaceId = ctx.query.get("workspaceId");
    const projectId = ctx.query.get("projectId");

    if (!workspaceId) {
      return ResponseBuilder.badRequest("Missing workspaceId query parameter");
    }

    const designs = await this.designService.listByScope(
      workspaceId,
      projectId ?? null,
    );
    return ResponseBuilder.success({ designs });
  }

  async listByProject(ctx: RouteContext): Promise<Response> {
    const projectId = ctx.params.getOrThrow("projectId");
    const designs = await this.designService.listByProject(projectId);
    return ResponseBuilder.success({ designs });
  }

  async get(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const design = await this.designService.get(id);
    return ResponseBuilder.success({ design });
  }

  async create(ctx: RouteContext): Promise<Response> {
    const body = await ctx.req.json();
    const projectId = ctx.params.get("projectId");
    const design = await this.designService.create({ ...body, projectId });
    return ResponseBuilder.created({ design });
  }

  async update(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const body = await ctx.req.json();
    const design = await this.designService.update(id, body);
    return ResponseBuilder.success({ design });
  }

  async delete(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    await this.designService.delete(id);
    return ResponseBuilder.success({ deleted: true });
  }
}
