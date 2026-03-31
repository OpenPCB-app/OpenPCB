/**
 * Telemetry Types - V2 Kernel
 *
 * Type definitions for metrics and usage tracking.
 */

import type { ProviderId } from "@shared/types";
import type { TokenUsage } from "@shared/types";

/** Metric types */
export type MetricType = "counter" | "gauge" | "histogram";

/** Metric labels */
export interface MetricLabels {
  provider?: ProviderId;
  model?: string;
  status?: "success" | "error" | "cancelled";
  errorCode?: string;
  [key: string]: string | undefined;
}

/** Counter metric */
export interface CounterMetric {
  type: "counter";
  name: string;
  value: number;
  labels: MetricLabels;
  timestamp: string;
}

/** Gauge metric */
export interface GaugeMetric {
  type: "gauge";
  name: string;
  value: number;
  labels: MetricLabels;
  timestamp: string;
}

/** Histogram bucket */
export interface HistogramBucket {
  le: number; // less than or equal
  count: number;
}

/** Histogram metric */
export interface HistogramMetric {
  type: "histogram";
  name: string;
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels: MetricLabels;
  timestamp: string;
}

/** Any metric */
export type Metric = CounterMetric | GaugeMetric | HistogramMetric;

/** Usage record for a single request */
export interface UsageRecord {
  /** Unique record ID */
  id: string;
  /** Task ID this usage is for */
  taskId: string;
  /** Chat ID (if applicable) */
  chatId?: string;
  /** Provider used */
  provider: ProviderId;
  /** Model used */
  model: string;
  /** Token usage */
  usage: TokenUsage;
  /** Request duration in ms */
  durationMs: number;
  /** Request status */
  status: "success" | "error" | "cancelled";
  /** Error message (if failed) */
  errorMessage?: string;
  /** Timestamp */
  timestamp: string;
}

/** Aggregated usage summary */
export interface UsageSummary {
  /** Time period start */
  periodStart: string;
  /** Time period end */
  periodEnd: string;
  /** Total requests */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Cancelled requests */
  cancelledRequests: number;
  /** Total tokens */
  totalTokens: number;
  /** Prompt tokens */
  promptTokens: number;
  /** Completion tokens */
  completionTokens: number;
  /** Reasoning tokens */
  reasoningTokens: number;
  /** Average duration in ms */
  avgDurationMs: number;
  /** 95th percentile duration in ms */
  p95DurationMs: number;
  /** Breakdown by provider */
  byProvider: Record<ProviderId, ProviderUsageSummary>;
}

/** Provider-specific usage summary */
export interface ProviderUsageSummary {
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgDurationMs: number;
  /** Top models used */
  topModels: Array<{ model: string; requests: number; tokens: number }>;
}

/** Timing record */
export interface TimingRecord {
  /** Operation name */
  operation: string;
  /** Duration in ms */
  durationMs: number;
  /** Labels for filtering */
  labels: MetricLabels;
  /** Timestamp */
  timestamp: string;
}

/** Error record */
export interface ErrorRecord {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Provider (if applicable) */
  provider?: ProviderId;
  /** Model (if applicable) */
  model?: string;
  /** Task ID (if applicable) */
  taskId?: string;
  /** Stack trace */
  stack?: string;
  /** Timestamp */
  timestamp: string;
}

/** Metrics snapshot */
export interface MetricsSnapshot {
  /** Snapshot timestamp */
  timestamp: string;
  /** All counters */
  counters: CounterMetric[];
  /** All gauges */
  gauges: GaugeMetric[];
  /** All histograms */
  histograms: HistogramMetric[];
}

/** Default histogram buckets for response time (ms) */
export const DEFAULT_LATENCY_BUCKETS = [
  50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000,
];

/** Metric names */
export const MetricNames = {
  // Counters
  REQUESTS_TOTAL: "kernel_requests_total",
  TOKENS_TOTAL: "kernel_tokens_total",
  ERRORS_TOTAL: "kernel_errors_total",

  // Gauges
  ACTIVE_TASKS: "kernel_active_tasks",
  ACTIVE_STREAMS: "kernel_active_streams",

  // Histograms
  REQUEST_DURATION: "kernel_request_duration_ms",
  TOKENS_PER_REQUEST: "kernel_tokens_per_request",
} as const;
