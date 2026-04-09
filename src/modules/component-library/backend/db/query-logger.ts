/**
 * Query Logger
 *
 * Minimal logger used by module repositories. No-op by default; wire to
 * ctx.logger via an adapter if deeper instrumentation is needed later.
 */

export class QueryLogger {
  constructor(
    private readonly options: {
      slowQueryThreshold?: number;
      enableLogging?: boolean;
    } = {},
  ) {}

  logQuery(sql: string, duration: number, _params?: unknown[]): void {
    if (this.options.enableLogging === false) return;
    const threshold = this.options.slowQueryThreshold ?? 100;
    if (duration > threshold) {
      console.warn(
        `[QueryLogger] Slow query (${duration.toFixed(2)}ms):`,
        sql.substring(0, 100),
      );
    }
  }
}
