/**
 * Query logging wrapper for repository methods.
 */

import type { QueryLogger } from "./query-logger";
import { parseSQLiteError } from "./errors";

export async function withQueryLogging<T>(
  logger: QueryLogger,
  entityName: string,
  methodName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  const fullName = `${entityName}.${methodName}`;

  try {
    const result = await fn();
    const duration = performance.now() - start;
    logger.logQuery(fullName, duration);
    return result;
  } catch (err) {
    const duration = performance.now() - start;
    logger.logQuery(`${fullName} [FAILED]`, duration);
    throw parseSQLiteError(err, fullName);
  }
}
