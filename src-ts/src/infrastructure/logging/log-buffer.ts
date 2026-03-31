import type { LogEntry } from "@shared/types/logger";

/**
 * Configuration for the log buffer
 */
interface LogBufferConfig {
  maxSize: number;
}

const REDACTION_MARKER = "[REDACTED]";
const SENSITIVE_KEYS = [
  "token",
  "secret",
  "session",
  "authorization",
  "cookie",
  "entitlementjws",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

function looksLikeJwt(value: string): boolean {
  const segments = value.split(".");
  return segments.length === 3 && segments.every((segment) => segment.length > 0);
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (isPlainObject(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      redacted[key] = shouldRedactKey(key) ? REDACTION_MARKER : redactValue(nested);
    }
    return redacted;
  }

  if (typeof value === "string" && looksLikeJwt(value)) {
    return REDACTION_MARKER;
  }

  return value;
}

/**
 * In-memory circular log buffer for backend logs
 * Captures console output for debugging and feedback
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

  constructor(config: LogBufferConfig = { maxSize: 2000 }) {
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
   * Initialize log interception
   */
  initialize(): void {
    if (this.isInitialized) {
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
   * Add a log entry
   */
  private addEntry(level: LogEntry["level"], args: unknown[]): void {
    const redactedArgs = args.map((arg) => redactValue(arg));

    const message = redactedArgs
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
      args: redactedArgs,
      source: "backend",
    };

    this.buffer.push(entry);

    if (this.buffer.length > this.config.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * Get recent logs with optional filtering
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
   * Get logs from last N minutes
   */
  getLogsFromLastMinutes(minutes: number): LogEntry[] {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    return this.getRecentLogs({ since });
  }

  /**
   * Get logs as formatted text
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
   * Clear buffer
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * Get stats
   */
  getStats(): { total: number; maxSize: number } {
    return {
      total: this.buffer.length,
      maxSize: this.config.maxSize,
    };
  }
}

/**
 * Global instance
 */
export const logBuffer = new LogBuffer({ maxSize: 2000 });

/**
 * Initialize backend log capture
 */
export function initializeLogBuffer(): void {
  logBuffer.initialize();
}
