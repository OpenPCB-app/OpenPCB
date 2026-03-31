/**
 * Logger Interface
 *
 * Provides module-scoped logging functionality.
 * Runtime implementations may use console, file logging, or remote logging.
 */

/**
 * Log entry level
 */
export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

/**
 * Single log entry
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  args: unknown[];
  source: "frontend" | "backend";
}

/**
 * Logs response from backend
 */
export interface LogsResponse {
  logs: LogEntry[];
  count: number;
  timeRange: {
    from: string;
    to: string;
  };
}

/**
 * Logger interface for module logging
 * Provides scoped logging with consistent prefixes and log levels
 */
export interface Logger {
  /**
   * Log informational message
   * @param args - Values to log
   */
  info(...args: unknown[]): void;

  /**
   * Log warning message
   * @param args - Values to log
   */
  warn(...args: unknown[]): void;

  /**
   * Log error message
   * @param args - Values to log
   */
  error(...args: unknown[]): void;

  /**
   * Log debug message
   * @param args - Values to log
   */
  debug(...args: unknown[]): void;

  /**
   * General log method
   * @param args - Values to log
   */
  log(...args: unknown[]): void;
}
