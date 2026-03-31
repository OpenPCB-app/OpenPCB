import type { DatabaseAccess } from "../../db";
import type { UsageRecord, UsageBudget } from "../../db/schema/usage";
import { NotFoundError, ValidationError } from "../../core/errors";
import type {
  CreateUsageRecordInput,
  CreateUsageBudgetInput,
  UpdateUsageBudgetInput,
  UsageSummaryResponse,
  BudgetStatusResponse,
  UsageListQuery,
  UsageRecordData,
  UsageBudgetData,
  BudgetPeriod,
} from "@shared/types/usage.types";

export interface IUsageService {
  recordUsage(input: CreateUsageRecordInput): Promise<UsageRecord>;
  listUsage(query: UsageListQuery): Promise<UsageRecordData[]>;
  getUsageSummary(
    workspaceId: string,
    period: "day" | "week" | "month" | "all",
  ): Promise<UsageSummaryResponse>;
  createBudget(input: CreateUsageBudgetInput): Promise<UsageBudget>;
  updateBudget(id: string, input: UpdateUsageBudgetInput): Promise<UsageBudget>;
  deleteBudget(id: string): Promise<{ deleted: boolean }>;
  getBudgetStatus(workspaceId: string): Promise<BudgetStatusResponse | null>;
  checkBudgetBeforeRequest(workspaceId: string): Promise<{
    allowed: boolean;
    reason?: string;
    budget?: BudgetStatusResponse;
  }>;
}

export class UsageService implements IUsageService {
  constructor(private db: DatabaseAccess) {}

  async recordUsage(input: CreateUsageRecordInput): Promise<UsageRecord> {
    if (!input.workspaceId) {
      throw new ValidationError("Workspace ID is required");
    }

    const costCents = input.costCents ?? this.calculateCost(input);

    const record = await this.db.usageRecords.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      chatId: input.chatId ?? null,
      taskId: input.taskId ?? null,
      provider: input.provider,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.totalTokens,
      costCents,
      promptPricePerMillion: input.promptPricePerMillion ?? null,
      completionPricePerMillion: input.completionPricePerMillion ?? null,
      requestType: input.requestType,
      status: input.status ?? "completed",
      durationMs: input.durationMs ?? null,
    });

    const budget = await this.db.usageBudgets.findActiveByWorkspace(
      input.workspaceId,
    );
    if (budget) {
      await this.db.usageBudgets.incrementUsage(budget.id, costCents);
    }

    return record;
  }

  async listUsage(query: UsageListQuery): Promise<UsageRecordData[]> {
    const records = await this.db.usageRecords.findByQuery(query);
    return records.map(this.toUsageRecordData);
  }

  async getUsageSummary(
    workspaceId: string,
    period: "day" | "week" | "month" | "all",
  ): Promise<UsageSummaryResponse> {
    const { startDate, endDate } = this.getPeriodDates(period);

    const totals = await this.db.usageRecords.sumByWorkspace(
      workspaceId,
      startDate,
      endDate,
    );

    const byProviderModel = await this.db.usageRecords.sumByProviderModel(
      workspaceId,
      startDate,
      endDate,
    );

    const byProvider: UsageSummaryResponse["byProvider"] = {};
    const byModel: UsageSummaryResponse["byModel"] = {};

    for (const row of byProviderModel) {
      const existing = byProvider[row.provider] ?? {
        tokens: 0,
        costCents: 0,
        requests: 0,
      };
      existing.tokens += row.totalTokens;
      existing.costCents += row.costCents;
      existing.requests += row.requestCount;
      byProvider[row.provider] = existing;

      const modelKey = `${row.provider}/${row.model}`;
      byModel[modelKey] = {
        tokens: row.totalTokens,
        costCents: row.costCents,
        requests: row.requestCount,
      };
    }

    return {
      workspaceId,
      projectId: null,
      period,
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
      totalTokens: totals.totalTokens,
      promptTokens: totals.promptTokens,
      completionTokens: totals.completionTokens,
      totalCostCents: totals.costCents,
      requestCount: totals.requestCount,
      byProvider,
      byModel,
    };
  }

  async createBudget(input: CreateUsageBudgetInput): Promise<UsageBudget> {
    if (!input.workspaceId) {
      throw new ValidationError("Workspace ID is required");
    }
    if (input.limitCents <= 0) {
      throw new ValidationError("Budget limit must be positive");
    }

    const existingBudget = await this.db.usageBudgets.findActiveByWorkspace(
      input.workspaceId,
    );
    if (existingBudget) {
      throw new ValidationError(
        "Active workspace budget already exists. Update or deactivate it first.",
      );
    }

    const periodStart = this.getPeriodStart(input.period ?? "monthly");

    const existingUsage = await this.db.usageRecords.sumByWorkspace(
      input.workspaceId,
      periodStart,
      new Date(),
    );

    return this.db.usageBudgets.create({
      workspaceId: input.workspaceId,
      limitCents: input.limitCents,
      warnAtPercent: input.warnAtPercent ?? 90,
      period: input.period ?? "monthly",
      periodStartAt: periodStart,
      currentUsageCents: existingUsage.costCents,
      actionOnLimit: input.actionOnLimit ?? "warn",
      isActive: true,
    });
  }

  async updateBudget(
    id: string,
    input: UpdateUsageBudgetInput,
  ): Promise<UsageBudget> {
    const budget = await this.db.usageBudgets.findById(id);
    if (!budget) {
      throw new NotFoundError("UsageBudget", id);
    }

    const updateData: Record<string, unknown> = {};
    if (input.limitCents !== undefined) {
      if (input.limitCents <= 0) {
        throw new ValidationError("Budget limit must be positive");
      }
      updateData.limitCents = input.limitCents;
    }
    if (input.warnAtPercent !== undefined) {
      updateData.warnAtPercent = input.warnAtPercent;
    }
    if (input.period !== undefined) {
      updateData.period = input.period;
    }
    if (input.actionOnLimit !== undefined) {
      updateData.actionOnLimit = input.actionOnLimit;
    }
    if (input.isActive !== undefined) {
      updateData.isActive = input.isActive;
    }

    return this.db.usageBudgets.update(id, updateData);
  }

  async deleteBudget(id: string): Promise<{ deleted: boolean }> {
    const budget = await this.db.usageBudgets.findById(id);
    if (!budget) {
      throw new NotFoundError("UsageBudget", id);
    }
    await this.db.usageBudgets.delete(id);
    return { deleted: true };
  }

  async getBudgetStatus(
    workspaceId: string,
  ): Promise<BudgetStatusResponse | null> {
    const budget =
      await this.db.usageBudgets.findActiveByWorkspace(workspaceId);
    if (!budget) return null;

    return this.computeBudgetStatus(budget);
  }

  async checkBudgetBeforeRequest(workspaceId: string): Promise<{
    allowed: boolean;
    reason?: string;
    budget?: BudgetStatusResponse;
  }> {
    const status = await this.getBudgetStatus(workspaceId);
    if (!status) {
      return { allowed: true };
    }

    if (status.isExceeded && status.budget.actionOnLimit === "block") {
      return {
        allowed: false,
        reason: `Budget exceeded (${status.usedPercent.toFixed(1)}% of limit)`,
        budget: status,
      };
    }

    return { allowed: true, budget: status };
  }

  private computeBudgetStatus(budget: UsageBudget): BudgetStatusResponse {
    const usedCents = budget.currentUsageCents;
    const remainingCents = Math.max(0, budget.limitCents - usedCents);
    const usedPercent =
      budget.limitCents > 0 ? (usedCents / budget.limitCents) * 100 : 0;
    const isWarning = usedPercent >= budget.warnAtPercent;
    const isExceeded = usedCents >= budget.limitCents;
    const periodEnd = this.getNextPeriodStart(
      budget.period as BudgetPeriod,
      budget.periodStartAt,
    );

    return {
      budget: this.toBudgetData(budget),
      usedCents,
      remainingCents,
      usedPercent,
      isWarning,
      isExceeded,
      periodEnd: periodEnd.toISOString(),
    };
  }

  private calculateCost(input: CreateUsageRecordInput): number {
    if (!input.promptPricePerMillion || !input.completionPricePerMillion) {
      return 0;
    }
    const promptCost =
      (input.promptTokens / 1_000_000) * input.promptPricePerMillion * 100;
    const completionCost =
      (input.completionTokens / 1_000_000) *
      input.completionPricePerMillion *
      100;
    return promptCost + completionCost;
  }

  private getPeriodDates(period: "day" | "week" | "month" | "all"): {
    startDate: Date;
    endDate: Date;
  } {
    const now = new Date();
    const endDate = now;
    let startDate: Date;

    switch (period) {
      case "day":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "week":
        startDate = new Date(now);
        const day = now.getDay() || 7;
        startDate.setDate(now.getDate() - day + 1); // Monday
        startDate.setHours(0, 0, 0, 0);
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "all":
        startDate = new Date(0);
        break;
    }

    return { startDate, endDate };
  }

  private getPeriodStart(period: BudgetPeriod): Date {
    const now = new Date();
    switch (period) {
      case "daily":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case "weekly": {
        const start = new Date(now);
        const day = now.getDay() || 7;
        start.setDate(now.getDate() - day + 1);
        start.setHours(0, 0, 0, 0);
        return start;
      }
      case "monthly":
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }

  private getNextPeriodStart(period: BudgetPeriod, currentStart: Date): Date {
    const start = new Date(currentStart);
    switch (period) {
      case "daily":
        start.setDate(start.getDate() + 1);
        break;
      case "weekly":
        start.setDate(start.getDate() + 7);
        break;
      case "monthly":
        start.setMonth(start.getMonth() + 1);
        break;
    }
    return start;
  }

  private toUsageRecordData(record: UsageRecord): UsageRecordData {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      projectId: record.projectId,
      chatId: record.chatId,
      taskId: record.taskId,
      provider: record.provider,
      model: record.model,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      totalTokens: record.totalTokens,
      costCents: record.costCents,
      requestType: record.requestType,
      status: record.status,
      durationMs: record.durationMs,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private toBudgetData(budget: UsageBudget): UsageBudgetData {
    return {
      id: budget.id,
      workspaceId: budget.workspaceId,
      limitCents: budget.limitCents,
      warnAtPercent: budget.warnAtPercent,
      period: budget.period as BudgetPeriod,
      periodStartAt: budget.periodStartAt.toISOString(),
      currentUsageCents: budget.currentUsageCents,
      actionOnLimit: budget.actionOnLimit as "warn" | "block" | "notify",
      isActive: budget.isActive,
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
    };
  }
}
