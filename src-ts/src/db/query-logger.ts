/**
 * Query Logger
 *
 * Tracks query execution metrics and detects slow queries.
 */

export interface QueryMetrics {
  /** Number of times this query was executed */
  count: number;
  /** Total duration across all executions (ms) */
  totalDuration: number;
  /** Average duration per execution (ms) */
  avgDuration: number;
  /** Maximum duration for a single execution (ms) */
  maxDuration: number;
  /** Number of slow query occurrences (>100ms) */
  slowQueryCount: number;
}

export interface QueryLogEntry {
  sql: string;
  duration: number;
  timestamp: number;
  params?: unknown[];
  isSlow: boolean;
}

/**
 * Logs database queries and tracks performance metrics
 */
export class QueryLogger {
  private metrics = new Map<string, QueryMetrics>();
  private slowQueryThreshold: number;
  private enableLogging: boolean;

  constructor(options: { slowQueryThreshold?: number; enableLogging?: boolean } = {}) {
    this.slowQueryThreshold = options.slowQueryThreshold ?? 100; // ms
    this.enableLogging = options.enableLogging ?? true;
  }

  /**
   * Log a query execution
   */
  logQuery(sql: string, duration: number, _params?: unknown[]): void {
    if (!this.enableLogging) return;

    const isSlow = this.detectSlowQuery(duration);
    const normalizedSql = this.normalizeSql(sql);

    // Update metrics
    const existing = this.metrics.get(normalizedSql);
    if (existing) {
      existing.count++;
      existing.totalDuration += duration;
      existing.avgDuration = existing.totalDuration / existing.count;
      existing.maxDuration = Math.max(existing.maxDuration, duration);
      if (isSlow) existing.slowQueryCount++;
    } else {
      this.metrics.set(normalizedSql, {
        count: 1,
        totalDuration: duration,
        avgDuration: duration,
        maxDuration: duration,
        slowQueryCount: isSlow ? 1 : 0,
      });
    }

    // Log slow queries to console
    if (isSlow) {
      console.warn(
        `[QueryLogger] Slow query (${duration.toFixed(2)}ms):`,
        normalizedSql.substring(0, 100)
      );
    }
  }

  /**
   * Get all query metrics
   */
  getMetrics(): Map<string, QueryMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Get metrics for a specific query
   */
  getQueryMetrics(sql: string): QueryMetrics | undefined {
    const normalized = this.normalizeSql(sql);
    return this.metrics.get(normalized);
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metrics.clear();
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalQueries: number;
    uniqueQueries: number;
    totalDuration: number;
    slowQueries: number;
    avgDuration: number;
  } {
    let totalQueries = 0;
    let totalDuration = 0;
    let slowQueries = 0;

    for (const metric of this.metrics.values()) {
      totalQueries += metric.count;
      totalDuration += metric.totalDuration;
      slowQueries += metric.slowQueryCount;
    }

    return {
      totalQueries,
      uniqueQueries: this.metrics.size,
      totalDuration,
      slowQueries,
      avgDuration: totalQueries > 0 ? totalDuration / totalQueries : 0,
    };
  }

  /**
   * Get top N slowest queries
   */
  getSlowestQueries(limit = 10): Array<{ sql: string; metrics: QueryMetrics }> {
    return Array.from(this.metrics.entries())
      .sort((a, b) => b[1].maxDuration - a[1].maxDuration)
      .slice(0, limit)
      .map(([sql, metrics]) => ({ sql, metrics }));
  }

  /**
   * Get most frequently executed queries
   */
  getMostFrequentQueries(limit = 10): Array<{ sql: string; metrics: QueryMetrics }> {
    return Array.from(this.metrics.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([sql, metrics]) => ({ sql, metrics }));
  }

  /**
   * Detect if query execution time exceeds threshold
   */
  private detectSlowQuery(duration: number): boolean {
    return duration > this.slowQueryThreshold;
  }

  /**
   * Normalize SQL for consistent metric tracking
   * Removes extra whitespace and normalizes formatting
   */
  private normalizeSql(sql: string): string {
    return sql
      .replace(/\s+/g, " ") // Collapse whitespace
      .replace(/\n/g, " ") // Remove newlines
      .trim()
      .substring(0, 500); // Limit length for map key
  }

  /**
   * Enable/disable logging
   */
  setLogging(enabled: boolean): void {
    this.enableLogging = enabled;
  }

  /**
   * Set slow query threshold
   */
  setSlowQueryThreshold(ms: number): void {
    this.slowQueryThreshold = ms;
  }
}
