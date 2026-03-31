import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import {
  usageRecord,
  type UsageRecord,
  type NewUsageRecord,
  usageBudget,
  type UsageBudget,
  type NewUsageBudget,
} from "../schema/usage";
import { BaseRepository } from "./base";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { withQueryLogging } from "../decorators";
import type { UsageListQuery } from "@shared/types/usage.types";

export class UsageRecordRepository extends BaseRepository<
  typeof usageRecord,
  UsageRecord,
  NewUsageRecord
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, usageRecord, logger, "UsageRecord");
  }

  async findByWorkspace(
    workspaceId: string,
    options?: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<UsageRecord[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByWorkspace",
      async () => {
        const conditions = [eq(usageRecord.workspaceId, workspaceId)];

        if (options?.startDate) {
          conditions.push(gte(usageRecord.createdAt, options.startDate));
        }
        if (options?.endDate) {
          conditions.push(lte(usageRecord.createdAt, options.endDate));
        }

        let query = this.db
          .select()
          .from(usageRecord)
          .where(and(...conditions))
          .orderBy(desc(usageRecord.createdAt));

        if (options?.limit) {
          query = query.limit(options.limit) as typeof query;
        }
        if (options?.offset) {
          query = query.offset(options.offset) as typeof query;
        }

        return query;
      },
    );
  }

  async findByQuery(query: UsageListQuery): Promise<UsageRecord[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByQuery",
      async () => {
        const conditions = [eq(usageRecord.workspaceId, query.workspaceId)];

        if (query.projectId) {
          conditions.push(eq(usageRecord.projectId, query.projectId));
        }
        if (query.chatId) {
          conditions.push(eq(usageRecord.chatId, query.chatId));
        }
        if (query.provider) {
          conditions.push(eq(usageRecord.provider, query.provider));
        }
        if (query.model) {
          conditions.push(eq(usageRecord.model, query.model));
        }
        if (query.startDate) {
          conditions.push(
            gte(usageRecord.createdAt, new Date(query.startDate)),
          );
        }
        if (query.endDate) {
          conditions.push(lte(usageRecord.createdAt, new Date(query.endDate)));
        }

        let dbQuery = this.db
          .select()
          .from(usageRecord)
          .where(and(...conditions))
          .orderBy(desc(usageRecord.createdAt));

        if (query.limit) {
          dbQuery = dbQuery.limit(query.limit) as typeof dbQuery;
        }
        if (query.offset) {
          dbQuery = dbQuery.offset(query.offset) as typeof dbQuery;
        }

        return dbQuery;
      },
    );
  }

  async sumByWorkspace(
    workspaceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    costCents: number;
    requestCount: number;
  }> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "sumByWorkspace",
      async () => {
        const result = await this.db
          .select({
            totalTokens: sql<number>`coalesce(sum(${usageRecord.totalTokens}), 0)`,
            promptTokens: sql<number>`coalesce(sum(${usageRecord.promptTokens}), 0)`,
            completionTokens: sql<number>`coalesce(sum(${usageRecord.completionTokens}), 0)`,
            costCents: sql<number>`coalesce(sum(${usageRecord.costCents}), 0)`,
            requestCount: sql<number>`count(*)`,
          })
          .from(usageRecord)
          .where(
            and(
              eq(usageRecord.workspaceId, workspaceId),
              gte(usageRecord.createdAt, startDate),
              lte(usageRecord.createdAt, endDate),
            ),
          );

        return (
          result[0] ?? {
            totalTokens: 0,
            promptTokens: 0,
            completionTokens: 0,
            costCents: 0,
            requestCount: 0,
          }
        );
      },
    );
  }

  async sumByProviderModel(
    workspaceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      provider: string;
      model: string;
      totalTokens: number;
      costCents: number;
      requestCount: number;
    }>
  > {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "sumByProviderModel",
      async () => {
        return this.db
          .select({
            provider: usageRecord.provider,
            model: usageRecord.model,
            totalTokens: sql<number>`coalesce(sum(${usageRecord.totalTokens}), 0)`,
            costCents: sql<number>`coalesce(sum(${usageRecord.costCents}), 0)`,
            requestCount: sql<number>`count(*)`,
          })
          .from(usageRecord)
          .where(
            and(
              eq(usageRecord.workspaceId, workspaceId),
              gte(usageRecord.createdAt, startDate),
              lte(usageRecord.createdAt, endDate),
            ),
          )
          .groupBy(usageRecord.provider, usageRecord.model);
      },
    );
  }

  async findByTask(taskId: string): Promise<UsageRecord | null> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByTask",
      async () => {
        const result = await this.db
          .select()
          .from(usageRecord)
          .where(eq(usageRecord.taskId, taskId))
          .limit(1);
        return result[0] ?? null;
      },
    );
  }
}

export class UsageBudgetRepository extends BaseRepository<
  typeof usageBudget,
  UsageBudget,
  NewUsageBudget
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, usageBudget, logger, "UsageBudget");
  }

  async findByWorkspace(workspaceId: string): Promise<UsageBudget[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByWorkspace",
      async () => {
        return this.db
          .select()
          .from(usageBudget)
          .where(eq(usageBudget.workspaceId, workspaceId))
          .orderBy(desc(usageBudget.createdAt));
      },
    );
  }

  async findActiveByWorkspace(
    workspaceId: string,
  ): Promise<UsageBudget | null> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findActiveByWorkspace",
      async () => {
        const result = await this.db
          .select()
          .from(usageBudget)
          .where(
            and(
              eq(usageBudget.workspaceId, workspaceId),
              eq(usageBudget.isActive, true),
            ),
          )
          .orderBy(desc(usageBudget.createdAt))
          .limit(1);
        return result[0] ?? null;
      },
    );
  }

  async incrementUsage(budgetId: string, amountCents: number): Promise<void> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "incrementUsage",
      async () => {
        const result = await this.db
          .update(usageBudget)
          .set({
            currentUsageCents: sql`${usageBudget.currentUsageCents} + ${amountCents}`,
            updatedAt: new Date(),
          })
          .where(eq(usageBudget.id, budgetId))
          .returning({ id: usageBudget.id });

        if (result.length === 0) {
          throw new Error(`Budget not found: ${budgetId}`);
        }
      },
    );
  }

  async resetPeriod(budgetId: string, newPeriodStart: Date): Promise<void> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "resetPeriod",
      async () => {
        const result = await this.db
          .update(usageBudget)
          .set({
            periodStartAt: newPeriodStart,
            currentUsageCents: 0,
            updatedAt: new Date(),
          })
          .where(eq(usageBudget.id, budgetId))
          .returning({ id: usageBudget.id });

        if (result.length === 0) {
          throw new Error(`Budget not found: ${budgetId}`);
        }
      },
    );
  }
}
