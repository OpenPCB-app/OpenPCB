import type { LogEntry, LogsResponse } from "@shared/types/logger";
import { logBuffer } from "../../infrastructure/logging/log-buffer";
import { DatabaseAccess } from "../../db";
import { getMetricsCollector } from "../../infrastructure/telemetry/metrics";

/**
 * Diagnostics Controller
 * Provides system diagnostics and logs for debugging and feedback
 */
export class DiagnosticsController {
  /**
   * Get recent backend logs
   */
  async getLogs(query: {
    minutes?: number;
    count?: number;
    level?: string | string[];
  }): Promise<LogsResponse> {
    const minutes = query.minutes ? parseInt(String(query.minutes), 10) : 5;
    const count = query.count ? parseInt(String(query.count), 10) : undefined;

    let level: LogEntry["level"] | LogEntry["level"][] | undefined;
    if (query.level) {
      const validLevels: LogEntry["level"][] = [
        "log",
        "info",
        "warn",
        "error",
        "debug",
      ];
      const levels = Array.isArray(query.level)
        ? query.level
        : [query.level];
      level = levels.filter((l) =>
        validLevels.includes(l as LogEntry["level"])
      ) as LogEntry["level"][];
      if (level.length === 0) level = undefined;
    }

    const logs = logBuffer.getRecentLogs({
      since: new Date(Date.now() - minutes * 60 * 1000),
      count,
      level,
    });

    const now = new Date();
    const from = new Date(now.getTime() - minutes * 60 * 1000);

    return {
      logs,
      count: logs.length,
      timeRange: {
        from: from.toISOString(),
        to: now.toISOString(),
      },
    };
  }

  /**
   * Get system diagnostics snapshot
   */
  async getDiagnostics(): Promise<{
    logs: LogsResponse;
    database: {
      querySummary: ReturnType<DatabaseAccess["getQuerySummary"]>;
      slowQueries: ReturnType<DatabaseAccess["getSlowestQueries"]>;
    };
    metrics: ReturnType<ReturnType<typeof getMetricsCollector>["snapshot"]>;
    timestamp: string;
  }> {
    const db = DatabaseAccess.getInstance();
    const metricsCollector = getMetricsCollector();

    const logs = await this.getLogs({ minutes: 5 });

    return {
      logs,
      database: {
        querySummary: db.getQuerySummary(),
        slowQueries: db.getSlowestQueries(50),
      },
      metrics: metricsCollector.snapshot(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get logs as formatted text (for download/display)
   */
  async getLogsAsText(query: { minutes?: number }): Promise<string> {
    const minutes = query.minutes ? parseInt(String(query.minutes), 10) : 5;
    return logBuffer.getLogsAsText({ count: 1000 });
  }
}
