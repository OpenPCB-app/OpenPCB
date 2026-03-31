import type { RouteContext } from "../router";
import type { IUsageService } from "../../domain/services/usage-service";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class UsageController {
  constructor(private usageService: IUsageService) {}

  /**
   * GET /api/usage - List usage records
   * Query params: workspaceId (required), projectId, chatId, provider, model, startDate, endDate, limit, offset
   */
  async list(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;

    if (!workspaceId) {
      return ResponseBuilder.badRequest("Missing workspaceId query parameter");
    }

    const query = {
      workspaceId,
      projectId: url.searchParams.get("projectId")?.trim() || undefined,
      chatId: url.searchParams.get("chatId")?.trim() || undefined,
      provider: url.searchParams.get("provider")?.trim() || undefined,
      model: url.searchParams.get("model")?.trim() || undefined,
      startDate: url.searchParams.get("startDate")?.trim() || undefined,
      endDate: url.searchParams.get("endDate")?.trim() || undefined,
      limit: (() => {
        const val = url.searchParams.get("limit");
        if (!val) return undefined;
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      })(),
      offset: (() => {
        const val = url.searchParams.get("offset");
        if (!val) return undefined;
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      })(),
    };

    const records = await this.usageService.listUsage(query);
    return ResponseBuilder.success({ records });
  }

  /**
   * GET /api/usage/summary - Get usage summary for workspace
   * Query params: workspaceId (required), period (day|week|month|all)
   */
  async getSummary(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;
    const period = url.searchParams.get("period")?.trim() || "month";

    if (!workspaceId) {
      return ResponseBuilder.badRequest("Missing workspaceId query parameter");
    }

    if (!["day", "week", "month", "all"].includes(period)) {
      return ResponseBuilder.badRequest(
        "Invalid period. Must be: day, week, month, or all",
      );
    }

    const summary = await this.usageService.getUsageSummary(
      workspaceId,
      period as "day" | "week" | "month" | "all",
    );
    return ResponseBuilder.success(summary);
  }

  /**
   * GET /api/budgets - List budgets for workspace
   * Query params: workspaceId (required)
   */
  async listBudgets(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;

    if (!workspaceId) {
      return ResponseBuilder.badRequest("Missing workspaceId query parameter");
    }

    const status = await this.usageService.getBudgetStatus(workspaceId);
    return ResponseBuilder.success({ budget: status?.budget || null });
  }

  /**
   * POST /api/budgets - Create budget
   */
  async createBudget(ctx: RouteContext): Promise<Response> {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    if (!parsed.workspaceId || typeof parsed.workspaceId !== "string") {
      return ResponseBuilder.badRequest("workspaceId is required");
    }
    if (typeof parsed.limitCents !== "number" || parsed.limitCents <= 0) {
      return ResponseBuilder.badRequest(
        "limitCents is required and must be positive",
      );
    }

    const budget = await this.usageService.createBudget({
      workspaceId: parsed.workspaceId,
      projectId: (parsed.projectId as string | undefined) || undefined,
      limitCents: parsed.limitCents,
      warnAtPercent: (parsed.warnAtPercent as number | undefined) ?? 90,
      period: this.validatePeriod(parsed.period) ?? "monthly",
      actionOnLimit: this.validateActionOnLimit(parsed.actionOnLimit) ?? "warn",
    });
    return ResponseBuilder.created({ budget });
  }

  private validatePeriod(
    value: unknown,
  ): "daily" | "weekly" | "monthly" | undefined {
    if (value === undefined) return undefined;
    if (["daily", "weekly", "monthly"].includes(value as string)) {
      return value as "daily" | "weekly" | "monthly";
    }
    return undefined;
  }

  private validateActionOnLimit(
    value: unknown,
  ): "warn" | "block" | "notify" | undefined {
    if (value === undefined) return undefined;
    if (["warn", "block", "notify"].includes(value as string)) {
      return value as "warn" | "block" | "notify";
    }
    return undefined;
  }

  /**
   * PATCH /api/budgets/:id - Update budget
   */
  async updateBudget(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;

    if (
      parsed.limitCents !== undefined &&
      (typeof parsed.limitCents !== "number" || parsed.limitCents <= 0)
    ) {
      return ResponseBuilder.badRequest("limitCents must be a positive number");
    }
    if (
      parsed.warnAtPercent !== undefined &&
      (typeof parsed.warnAtPercent !== "number" ||
        parsed.warnAtPercent < 0 ||
        parsed.warnAtPercent > 100)
    ) {
      return ResponseBuilder.badRequest(
        "warnAtPercent must be between 0 and 100",
      );
    }
    if (
      parsed.period !== undefined &&
      !["daily", "weekly", "monthly"].includes(parsed.period as string)
    ) {
      return ResponseBuilder.badRequest(
        "period must be: daily, weekly, or monthly",
      );
    }
    if (
      parsed.actionOnLimit !== undefined &&
      !["warn", "block", "notify"].includes(parsed.actionOnLimit as string)
    ) {
      return ResponseBuilder.badRequest(
        "actionOnLimit must be: warn, block, or notify",
      );
    }
    if (parsed.isActive !== undefined && typeof parsed.isActive !== "boolean") {
      return ResponseBuilder.badRequest("isActive must be a boolean");
    }

    const budget = await this.usageService.updateBudget(id, {
      limitCents: parsed.limitCents as number | undefined,
      warnAtPercent: parsed.warnAtPercent as number | undefined,
      period: parsed.period as "daily" | "weekly" | "monthly" | undefined,
      actionOnLimit: parsed.actionOnLimit as
        | "warn"
        | "block"
        | "notify"
        | undefined,
      isActive: parsed.isActive as boolean | undefined,
    });
    return ResponseBuilder.success({ budget });
  }

  /**
   * DELETE /api/budgets/:id - Delete budget
   */
  async deleteBudget(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const result = await this.usageService.deleteBudget(id);
    return ResponseBuilder.success(result);
  }

  /**
   * GET /api/budgets/status - Get current budget status
   * Query params: workspaceId (required)
   */
  async getBudgetStatus(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;

    if (!workspaceId) {
      return ResponseBuilder.badRequest("Missing workspaceId query parameter");
    }

    const status = await this.usageService.getBudgetStatus(workspaceId);
    return ResponseBuilder.success({ status });
  }
}
