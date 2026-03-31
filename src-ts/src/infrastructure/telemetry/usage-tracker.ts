/**
 * Usage Tracker - Infrastructure
 *
 * Tracks token usage, request statistics, and costs.
 */

import type { ProviderId } from "@shared/types";
import type { TokenUsage } from "@shared/types";
import {
  type UsageRecord,
  type UsageSummary,
  type ProviderUsageSummary,
  MetricNames,
} from "./types.ts";
import { type MetricsCollector, getMetricsCollector } from "./metrics.ts";

/** Usage tracker configuration */
export interface UsageTrackerConfig {
  /** Max records to keep in memory */
  maxRecords: number;
  /** Retention period in ms */
  retentionMs: number;
  /** Metrics collector to update */
  metrics?: MetricsCollector;
}

/** Default config */
const DEFAULT_CONFIG: UsageTrackerConfig = {
  maxRecords: 10000,
  retentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};

/**
 * Tracks usage records and provides aggregated statistics.
 */
export class UsageTracker {
  private records: UsageRecord[] = [];
  private config: UsageTrackerConfig;
  private metrics: MetricsCollector;

  constructor(config: Partial<UsageTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = config.metrics ?? getMetricsCollector();
  }

  /**
   * Record a completed request.
   */
  record(data: {
    taskId: string;
    chatId?: string;
    provider: ProviderId;
    model: string;
    usage: TokenUsage;
    durationMs: number;
    status: "success" | "error" | "cancelled";
    errorMessage?: string;
  }): UsageRecord {
    const record: UsageRecord = {
      id: crypto.randomUUID(),
      taskId: data.taskId,
      chatId: data.chatId,
      provider: data.provider,
      model: data.model,
      usage: data.usage,
      durationMs: data.durationMs,
      status: data.status,
      errorMessage: data.errorMessage,
      timestamp: new Date().toISOString(),
    };

    this.records.push(record);
    this.enforceRetention();

    // Update metrics
    this.updateMetrics(record);

    return record;
  }

  /**
   * Get all records.
   */
  getRecords(filter?: {
    provider?: ProviderId;
    model?: string;
    status?: "success" | "error" | "cancelled";
    chatId?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): UsageRecord[] {
    let results = [...this.records];

    if (filter?.provider) {
      results = results.filter((r) => r.provider === filter.provider);
    }
    if (filter?.model) {
      results = results.filter((r) => r.model === filter.model);
    }
    if (filter?.status) {
      results = results.filter((r) => r.status === filter.status);
    }
    if (filter?.chatId) {
      results = results.filter((r) => r.chatId === filter.chatId);
    }
    if (filter?.since) {
      results = results.filter((r) => r.timestamp >= filter.since!);
    }
    if (filter?.until) {
      results = results.filter((r) => r.timestamp <= filter.until!);
    }

    // Sort newest first
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get usage summary for a time period.
   */
  getSummary(periodStart?: string, periodEnd?: string): UsageSummary {
    const now = new Date().toISOString();
    const start = periodStart ?? new Date(0).toISOString();
    const end = periodEnd ?? now;

    const records = this.getRecords({ since: start, until: end });

    // Initialize summary
    const summary: UsageSummary = {
      periodStart: start,
      periodEnd: end,
      totalRequests: records.length,
      successfulRequests: 0,
      failedRequests: 0,
      cancelledRequests: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      avgDurationMs: 0,
      p95DurationMs: 0,
      byProvider: {} as Record<ProviderId, ProviderUsageSummary>,
    };

    if (records.length === 0) {
      return summary;
    }

    // Aggregate
    const durations: number[] = [];
    const providerData: Record<
      ProviderId,
      {
        requests: number;
        successful: number;
        failed: number;
        tokens: number;
        promptTokens: number;
        completionTokens: number;
        durations: number[];
        models: Map<string, { requests: number; tokens: number }>;
      }
    > = {} as Record<ProviderId, any>;

    for (const record of records) {
      // Status counts
      if (record.status === "success") {
        summary.successfulRequests++;
      } else if (record.status === "error") {
        summary.failedRequests++;
      } else {
        summary.cancelledRequests++;
      }

      // Token counts
      summary.promptTokens += record.usage.promptTokens;
      summary.completionTokens += record.usage.completionTokens;
      summary.totalTokens += record.usage.totalTokens;
      summary.reasoningTokens += record.usage.reasoningTokens ?? 0;

      // Duration
      durations.push(record.durationMs);

      // Per-provider aggregation
      if (!providerData[record.provider]) {
        providerData[record.provider] = {
          requests: 0,
          successful: 0,
          failed: 0,
          tokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          durations: [],
          models: new Map(),
        };
      }

      // Non-null assertion safe: entry created above if missing
      const pd = providerData[record.provider]!;
      pd.requests++;
      if (record.status === "success") pd.successful++;
      if (record.status === "error") pd.failed++;
      pd.tokens += record.usage.totalTokens;
      pd.promptTokens += record.usage.promptTokens;
      pd.completionTokens += record.usage.completionTokens;
      pd.durations.push(record.durationMs);

      // Model tracking
      if (!pd.models.has(record.model)) {
        pd.models.set(record.model, { requests: 0, tokens: 0 });
      }
      const modelData = pd.models.get(record.model)!;
      modelData.requests++;
      modelData.tokens += record.usage.totalTokens;
    }

    // Calculate averages and percentiles
    summary.avgDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length;
    summary.p95DurationMs = percentile(durations, 95);

    // Build provider summaries
    for (const [providerId, pd] of Object.entries(providerData) as [
      ProviderId,
      typeof providerData[ProviderId],
    ][]) {
      const topModels = Array.from(pd.models.entries())
        .map(([model, data]) => ({ model, ...data }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 5);

      summary.byProvider[providerId] = {
        requests: pd.requests,
        successfulRequests: pd.successful,
        failedRequests: pd.failed,
        totalTokens: pd.tokens,
        promptTokens: pd.promptTokens,
        completionTokens: pd.completionTokens,
        avgDurationMs: pd.durations.reduce((a, b) => a + b, 0) / pd.durations.length,
        topModels,
      };
    }

    return summary;
  }

  /**
   * Get total token count for a period.
   */
  getTotalTokens(since?: string): number {
    const records = this.getRecords({ since, status: "success" });
    return records.reduce((sum, r) => sum + r.usage.totalTokens, 0);
  }

  /**
   * Get request count for a period.
   */
  getRequestCount(since?: string): number {
    return this.getRecords({ since }).length;
  }

  /**
   * Clear all records.
   */
  clear(): void {
    this.records = [];
  }

  /**
   * Get record count.
   */
  get count(): number {
    return this.records.length;
  }

  /** Update metrics based on usage record */
  private updateMetrics(record: UsageRecord): void {
    const labels = {
      provider: record.provider,
      model: record.model,
      status: record.status,
    };

    // Increment request counter
    this.metrics.incrementCounter(MetricNames.REQUESTS_TOTAL, labels);

    // Increment token counter
    this.metrics.incrementCounter(
      MetricNames.TOKENS_TOTAL,
      { provider: record.provider, model: record.model },
      record.usage.totalTokens,
    );

    // Record duration histogram
    this.metrics.observeHistogram(MetricNames.REQUEST_DURATION, record.durationMs, labels);

    // Record tokens per request histogram
    this.metrics.observeHistogram(
      MetricNames.TOKENS_PER_REQUEST,
      record.usage.totalTokens,
      { provider: record.provider, model: record.model },
      [10, 50, 100, 500, 1000, 2000, 5000, 10000],
    );

    // Increment error counter if failed
    if (record.status === "error") {
      this.metrics.incrementCounter(MetricNames.ERRORS_TOTAL, labels);
    }
  }

  /** Enforce retention limits */
  private enforceRetention(): void {
    // Enforce max records
    if (this.records.length > this.config.maxRecords) {
      this.records = this.records.slice(-this.config.maxRecords);
    }

    // Enforce time-based retention
    const cutoff = new Date(Date.now() - this.config.retentionMs).toISOString();
    this.records = this.records.filter((r) => r.timestamp >= cutoff);
  }
}

/** Calculate percentile of sorted values */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const result = sorted[Math.max(0, index)];
  return result ?? 0;
}

/** Create a new usage tracker */
export function createUsageTracker(config?: Partial<UsageTrackerConfig>): UsageTracker {
  return new UsageTracker(config);
}
