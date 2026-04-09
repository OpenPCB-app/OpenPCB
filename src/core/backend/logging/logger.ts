import type { Logger } from "../../contracts/modules/backend-module";

export type { Logger };

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogRecord {
  level: LogLevel;
  ts: string;
  prefix?: string;
  message: string;
  meta?: unknown;
}

function emit(record: LogRecord): void {
  const line: Record<string, unknown> = {
    level: record.level,
    ts: record.ts,
    message: record.message,
  };
  if (record.prefix) {
    line.source = record.prefix;
  }
  if (record.meta !== undefined) {
    line.meta = record.meta;
  }

  const payload = JSON.stringify(line);
  switch (record.level) {
    case "error":
      console.error(payload);
      return;
    case "warn":
      console.warn(payload);
      return;
    default:
      console.log(payload);
  }
}

/**
 * Create a logger. If `prefix` is provided, it's included in every record
 * as the `source` field, which is how module loggers identify themselves.
 */
export function createLogger(prefix?: string): Logger {
  const build = (level: LogLevel, message: string, meta?: unknown): void => {
    emit({
      level,
      ts: new Date().toISOString(),
      prefix,
      message,
      meta,
    });
  };

  return {
    debug: (message, meta) => build("debug", message, meta),
    info: (message, meta) => build("info", message, meta),
    warn: (message, meta) => build("warn", message, meta),
    error: (message, meta) => build("error", message, meta),
  };
}
