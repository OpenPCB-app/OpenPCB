/**
 * Usage Schema - Token and Cost Tracking
 *
 * Tracks AI provider usage per request for:
 * - Cost monitoring and budgeting
 * - Usage analytics per model/provider
 * - Rate limiting and quota enforcement
 *
 * See: TASK_SYSTEM_SPECIFICATION.md
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { workspace } from "./workspace";
import { project } from "./project";
import { chat } from "./chat";
import { task } from "./task";

// ─────────────────────────────────────────────────────────────────────────────
// Usage Record Table
// Stores individual usage records per task/request
// ─────────────────────────────────────────────────────────────────────────────

export const usageRecord = sqliteTable(
  "usage_record",
  {
    ...uuidPrimaryKey,

    // Context linking
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    chatId: text("chat_id").references(() => chat.id, { onDelete: "set null" }),
    taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),

    // Provider/model context
    provider: text("provider").notNull(),
    model: text("model").notNull(),

    // Token counts
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),

    // Cost calculation (in cents to avoid floating point issues)
    // e.g., $0.015 = 1500 microcents or 1.5 cents
    costCents: real("cost_cents").notNull().default(0),

    // Pricing metadata (for historical tracking)
    promptPricePerMillion: real("prompt_price_per_million"),
    completionPricePerMillion: real("completion_price_per_million"),

    // Request metadata
    requestType: text("request_type", {
      enum: ["message", "embedding", "load", "completion"],
    }).notNull(),

    // Status
    status: text("status", {
      enum: ["completed", "failed", "partial"],
    })
      .notNull()
      .default("completed"),

    // Timing
    durationMs: integer("duration_ms"),

    ...timestamps,
  },
  (table) => ({
    workspaceIdx: index("idx_usage_workspace").on(table.workspaceId),
    projectIdx: index("idx_usage_project").on(table.projectId),
    chatIdx: index("idx_usage_chat").on(table.chatId),
    taskIdx: index("idx_usage_task").on(table.taskId),
    providerModelIdx: index("idx_usage_provider_model").on(
      table.provider,
      table.model,
    ),
    createdIdx: index("idx_usage_created").on(table.createdAt),
    // Composite index for date-based aggregation queries
    workspaceDateIdx: index("idx_usage_workspace_date").on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
);

export type UsageRecord = typeof usageRecord.$inferSelect;
export type NewUsageRecord = typeof usageRecord.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Usage Budget Table
// Configurable spending limits per workspace/project
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Budget period types:
 * - daily: Resets every day at midnight UTC
 * - weekly: Resets every Monday at midnight UTC
 * - monthly: Resets on the 1st of each month at midnight UTC
 */
export const BUDGET_PERIODS = ["daily", "weekly", "monthly"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const usageBudget = sqliteTable(
  "usage_budget",
  {
    ...uuidPrimaryKey,

    // Scope - workspace level or project level
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),

    // Budget limits (in cents)
    limitCents: real("limit_cents").notNull(),
    warnAtPercent: integer("warn_at_percent").notNull().default(90),

    // Budget period
    period: text("period", { enum: BUDGET_PERIODS })
      .notNull()
      .default("monthly"),

    // Current period tracking
    periodStartAt: integer("period_start_at", {
      mode: "timestamp_ms",
    }).notNull(),
    currentUsageCents: real("current_usage_cents").notNull().default(0),

    // Actions when budget exceeded
    actionOnLimit: text("action_on_limit", {
      enum: ["warn", "block", "notify"],
    })
      .notNull()
      .default("warn"),

    // Budget status
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    ...timestamps,
  },
  (table) => ({
    workspaceIdx: index("idx_budget_workspace").on(table.workspaceId),
    activeIdx: index("idx_budget_active").on(table.isActive),
    periodStartIdx: index("idx_budget_period_start").on(table.periodStartAt),
  }),
);

export type UsageBudget = typeof usageBudget.$inferSelect;
export type NewUsageBudget = typeof usageBudget.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Usage Summary View Types
// For aggregated usage queries
// ─────────────────────────────────────────────────────────────────────────────

export interface UsageSummary {
  workspaceId: string;
  projectId: string | null;
  period: "day" | "week" | "month" | "all";
  periodStart: Date;
  periodEnd: Date;
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

export interface BudgetStatus {
  budget: UsageBudget;
  usedCents: number;
  remainingCents: number;
  usedPercent: number;
  isWarning: boolean;
  isExceeded: boolean;
  periodEnd: Date;
}
