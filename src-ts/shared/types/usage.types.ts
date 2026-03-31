export interface UsageRecordData {
  id: string;
  workspaceId: string;
  projectId: string | null;
  chatId: string | null;
  taskId: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents: number;
  requestType: "message" | "embedding" | "load" | "completion";
  status: "completed" | "failed" | "partial";
  durationMs: number | null;
  createdAt: string;
}

export interface CreateUsageRecordInput {
  workspaceId: string;
  projectId?: string | null;
  chatId?: string | null;
  taskId?: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents?: number;
  promptPricePerMillion?: number;
  completionPricePerMillion?: number;
  requestType: "message" | "embedding" | "load" | "completion";
  status?: "completed" | "failed" | "partial";
  durationMs?: number;
}

export type BudgetPeriod = "daily" | "weekly" | "monthly";
export type BudgetAction = "warn" | "block" | "notify";

export interface UsageBudgetData {
  id: string;
  workspaceId: string;
  limitCents: number;
  warnAtPercent: number;
  period: BudgetPeriod;
  periodStartAt: string;
  currentUsageCents: number;
  actionOnLimit: BudgetAction;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUsageBudgetInput {
  workspaceId: string;
  projectId?: string | null;
  limitCents: number;
  warnAtPercent?: number;
  period?: BudgetPeriod;
  actionOnLimit?: BudgetAction;
}

export interface UpdateUsageBudgetInput {
  limitCents?: number;
  warnAtPercent?: number;
  period?: BudgetPeriod;
  actionOnLimit?: BudgetAction;
  isActive?: boolean;
}

export interface UsageSummaryResponse {
  workspaceId: string;
  projectId: string | null;
  period: "day" | "week" | "month" | "all";
  periodStart: string;
  periodEnd: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostCents: number;
  requestCount: number;
  byProvider: Record<
    string,
    {
      tokens: number;
      costCents: number;
      requests: number;
    }
  >;
  byModel: Record<
    string,
    {
      tokens: number;
      costCents: number;
      requests: number;
    }
  >;
}

export interface BudgetStatusResponse {
  budget: UsageBudgetData;
  usedCents: number;
  remainingCents: number;
  usedPercent: number;
  isWarning: boolean;
  isExceeded: boolean;
  periodEnd: string;
}

export interface UsageListQuery {
  workspaceId: string;
  projectId?: string;
  chatId?: string;
  provider?: string;
  model?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}
