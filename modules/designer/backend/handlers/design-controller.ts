import type { RouteContext } from "../router";
import type { IDesignService } from "../../domain/services/design-service";
import { ResponseBuilder } from "../../core/utils/response-builder";
import { ProjectDocumentBundleSchema } from "../../core/schemas/pcb-project.schema";

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

  async getSheetContent(ctx: RouteContext): Promise<Response> {
    const designId = ctx.params.getOrThrow("id");
    const sheetIndex = Number(ctx.params.getOrThrow("sheetIndex"));

    if (!Number.isInteger(sheetIndex) || sheetIndex < 0) {
      return ResponseBuilder.badRequest(
        "sheetIndex must be a non-negative integer",
      );
    }

    const result = await this.designService.getSheetContent(
      designId,
      sheetIndex,
    );
    if (!result) {
      return ResponseBuilder.success({ sheet: null, content: null });
    }

    return ResponseBuilder.success(result);
  }

  async saveSheetContent(ctx: RouteContext): Promise<Response> {
    const designId = ctx.params.getOrThrow("id");
    const sheetIndex = Number(ctx.params.getOrThrow("sheetIndex"));

    if (!Number.isInteger(sheetIndex) || sheetIndex < 0) {
      return ResponseBuilder.badRequest(
        "sheetIndex must be a non-negative integer",
      );
    }

    const body = await ctx.req.json();
    const parsed = ProjectDocumentBundleSchema.safeParse(body.content);
    if (!parsed.success) {
      return ResponseBuilder.badRequest(
        `Invalid project bundle: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      );
    }

    const sheet = await this.designService.saveSheetContent(
      designId,
      sheetIndex,
      parsed.data,
    );

    return ResponseBuilder.success({ sheet });
  }
}
