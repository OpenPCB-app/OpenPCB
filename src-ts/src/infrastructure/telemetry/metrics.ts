/**
 * Metrics Collector - V2 Kernel
 *
 * Collects and aggregates metrics for monitoring.
 */

import {
  type MetricLabels,
  type CounterMetric,
  type GaugeMetric,
  type HistogramMetric,
  type HistogramBucket,
  type MetricsSnapshot,
  DEFAULT_LATENCY_BUCKETS,
} from "./types.ts";

/** Counter state */
interface CounterState {
  value: number;
  labels: MetricLabels;
}

/** Gauge state */
interface GaugeState {
  value: number;
  labels: MetricLabels;
}

/** Histogram state */
interface HistogramState {
  buckets: number[]; // counts per bucket
  bucketBoundaries: number[];
  sum: number;
  count: number;
  labels: MetricLabels;
}

/** Labels key for grouping */
function labelsKey(labels: MetricLabels): string {
  const sorted = Object.entries(labels)
    .filter(([_, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(sorted);
}

/**
 * Metrics collector for tracking counters, gauges, and histograms.
 */
export class MetricsCollector {
  private counters = new Map<string, Map<string, CounterState>>();
  private gauges = new Map<string, Map<string, GaugeState>>();
  private histograms = new Map<string, Map<string, HistogramState>>();

  /**
   * Increment a counter.
   */
  incrementCounter(name: string, labels: MetricLabels = {}, value = 1): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Map());
    }
    const counterMap = this.counters.get(name)!;
    const key = labelsKey(labels);

    if (!counterMap.has(key)) {
      counterMap.set(key, { value: 0, labels });
    }
    counterMap.get(key)!.value += value;
  }

  /**
   * Get counter value.
   */
  getCounter(name: string, labels: MetricLabels = {}): number {
    const counterMap = this.counters.get(name);
    if (!counterMap) return 0;

    const key = labelsKey(labels);
    return counterMap.get(key)?.value ?? 0;
  }

  /**
   * Set a gauge value.
   */
  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
    const gaugeMap = this.gauges.get(name)!;
    const key = labelsKey(labels);

    gaugeMap.set(key, { value, labels });
  }

  /**
   * Increment a gauge.
   */
  incrementGauge(name: string, labels: MetricLabels = {}, delta = 1): void {
    const current = this.getGauge(name, labels);
    this.setGauge(name, current + delta, labels);
  }

  /**
   * Decrement a gauge.
   */
  decrementGauge(name: string, labels: MetricLabels = {}, delta = 1): void {
    const current = this.getGauge(name, labels);
    this.setGauge(name, Math.max(0, current - delta), labels);
  }

  /**
   * Get gauge value.
   */
  getGauge(name: string, labels: MetricLabels = {}): number {
    const gaugeMap = this.gauges.get(name);
    if (!gaugeMap) return 0;

    const key = labelsKey(labels);
    return gaugeMap.get(key)?.value ?? 0;
  }

  /**
   * Record a histogram observation.
   */
  observeHistogram(
    name: string,
    value: number,
    labels: MetricLabels = {},
    buckets: number[] = DEFAULT_LATENCY_BUCKETS,
  ): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Map());
    }
    const histMap = this.histograms.get(name)!;
    const key = labelsKey(labels);

    if (!histMap.has(key)) {
      histMap.set(key, {
        buckets: new Array(buckets.length).fill(0),
        bucketBoundaries: buckets,
        sum: 0,
        count: 0,
        labels,
      });
    }

    const state = histMap.get(key)!;
    state.sum += value;
    state.count++;

    // Increment bucket counts
    for (let i = 0; i < state.bucketBoundaries.length; i++) {
      const boundary = state.bucketBoundaries[i];
      if (boundary !== undefined && value <= boundary) {
        state.buckets[i] = (state.buckets[i] || 0) + 1;
      }
    }
  }

  /**
   * Get histogram state.
   */
  getHistogram(
    name: string,
    labels: MetricLabels = {},
  ): { sum: number; count: number; buckets: HistogramBucket[] } | undefined {
    const histMap = this.histograms.get(name);
    if (!histMap) return undefined;

    const key = labelsKey(labels);
    const state = histMap.get(key);
    if (!state) return undefined;

    return {
      sum: state.sum,
      count: state.count,
      buckets: state.bucketBoundaries.map((le, i) => ({
        le,
        count: state.buckets[i] || 0,
      })),
    };
  }

  /**
   * Get a snapshot of all metrics.
   */
  snapshot(): MetricsSnapshot {
    const now = new Date().toISOString();
    const snapshot: MetricsSnapshot = {
      timestamp: now,
      counters: [],
      gauges: [],
      histograms: [],
    };

    // Collect counters
    for (const [name, counterMap] of this.counters) {
      for (const state of counterMap.values()) {
        snapshot.counters.push({
          type: "counter",
          name,
          value: state.value,
          labels: state.labels,
          timestamp: now,
        });
      }
    }

    // Collect gauges
    for (const [name, gaugeMap] of this.gauges) {
      for (const state of gaugeMap.values()) {
        snapshot.gauges.push({
          type: "gauge",
          name,
          value: state.value,
          labels: state.labels,
          timestamp: now,
        });
      }
    }

    // Collect histograms
    for (const [name, histMap] of this.histograms) {
      for (const state of histMap.values()) {
        snapshot.histograms.push({
          type: "histogram",
          name,
          buckets: state.bucketBoundaries.map((le, i) => ({
            le,
            count: state.buckets[i] || 0,
          })),
          sum: state.sum,
          count: state.count,
          labels: state.labels,
          timestamp: now,
        });
      }
    }

    return snapshot;
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  /**
   * Reset counters only.
   */
  resetCounters(): void {
    this.counters.clear();
  }
}

/** Global metrics collector instance */
let globalCollector: MetricsCollector | undefined;

/** Get or create global metrics collector */
export function getMetricsCollector(): MetricsCollector {
  if (!globalCollector) {
    globalCollector = new MetricsCollector();
  }
  return globalCollector;
}

/** Create a new metrics collector */
export function createMetricsCollector(): MetricsCollector {
  return new MetricsCollector();
}