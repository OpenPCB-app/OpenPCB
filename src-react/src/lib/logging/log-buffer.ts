/**
 * Log Entry - Represents a single log entry
 */
export interface LogEntry {
  timestamp: string;
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  args: unknown[];
  source: "frontend" | "backend";
}

/**
 * Log Buffer Configuration
 */
interface LogBufferConfig {
  maxSize: number;
}

/**
 * In-memory circular log buffer
 * Captures console logs for debugging and feedback
 */
class LogBuffer {
  private buffer: LogEntry[] = [];
  private config: LogBufferConfig;
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
  private isInitialized = false;

  constructor(config: LogBufferConfig = { maxSize: 1000 }) {
    this.config = config;
    this.originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };
  }

  /**
   * Initialize the log buffer - intercepts console methods
   */
  initialize(): void {
    if (this.isInitialized || typeof window === "undefined") {
      return;
    }

    console.log = (...args: unknown[]) => {
      this.addEntry("log", args);
      this.originalConsole.log(...args);
    };

    console.info = (...args: unknown[]) => {
      this.addEntry("info", args);
      this.originalConsole.info(...args);
    };

    console.warn = (...args: unknown[]) => {
      this.addEntry("warn", args);
      this.originalConsole.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      this.addEntry("error", args);
      this.originalConsole.error(...args);
    };

    console.debug = (...args: unknown[]) => {
      this.addEntry("debug", args);
      this.originalConsole.debug(...args);
    };

    this.isInitialized = true;
  }

  /**
   * Add a log entry to the buffer
   */
  private addEntry(level: LogEntry["level"], args: unknown[]): void {
    const message = args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      args,
      source: "frontend",
    };

    this.buffer.push(entry);

    // Keep buffer size limited
    if (this.buffer.length > this.config.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * Get recent logs, optionally filtered by level
   */
  getRecentLogs(options?: {
    count?: number;
    level?: LogEntry["level"] | LogEntry["level"][];
    since?: Date;
  }): LogEntry[] {
    let logs = [...this.buffer];

    if (options?.level) {
      const levels = Array.isArray(options.level)
        ? options.level
        : [options.level];
      logs = logs.filter((entry) => levels.includes(entry.level));
    }

    if (options?.since) {
      const sinceTime = options.since.getTime();
      logs = logs.filter(
        (entry) => new Date(entry.timestamp).getTime() >= sinceTime
      );
    }

    if (options?.count) {
      logs = logs.slice(-options.count);
    }

    return logs;
  }

  /**
   * Get logs from the last N minutes
   */
  getLogsFromLastMinutes(minutes: number): LogEntry[] {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    return this.getRecentLogs({ since });
  }

  /**
   * Get all logs as formatted text
   */
  getLogsAsText(options?: { count?: number }): string {
    const logs = this.getRecentLogs(options);
    return logs
      .map(
        (entry) =>
          `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`
      )
      .join("\n");
  }

  /**
   * Clear the log buffer
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * Get buffer stats
   */
  getStats(): { total: number; maxSize: number } {
    return {
      total: this.buffer.length,
      maxSize: this.config.maxSize,
    };
  }

  /**
   * Restore original console methods (cleanup)
   */
  destroy(): void {
    if (!this.isInitialized) return;

    console.log = this.originalConsole.log;
    console.info = this.originalConsole.info;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    console.debug = this.originalConsole.debug;

    this.isInitialized = false;
  }
}

/**
 * Global log buffer instance
 * Initialized on first import
 */
export const logBuffer = new LogBuffer({ maxSize: 1000 });

/**
 * Initialize log capturing
 * Call this early in app initialization (e.g., in main.tsx)
 */
export function initializeLogBuffer(): void {
  logBuffer.initialize();
}

/**
 * Get recent frontend logs for feedback/debugging
 */
export function getRecentLogs(minutes: number = 5): LogEntry[] {
  return logBuffer.getLogsFromLastMinutes(minutes);
}

/**
 * Format logs for transmission
 */
export function formatLogsForTransmission(logs: LogEntry[]): string {
  return logs
    .map(
      (entry) =>
        `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`
    )
    .join("\n");
}
