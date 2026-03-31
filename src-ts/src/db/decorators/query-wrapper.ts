import type { QueryLogger } from '../query-logger';
import { parseSQLiteError } from '../errors';

/**
 * Context interface for query logging
 */
export interface QueryLoggingContext {
    logger: QueryLogger;
    entityName: string;
}

/**
 * Query logging wrapper
 * Eliminates 100+ try-catch blocks in repositories
 *
 * Usage:
 *   return withQueryLogging(this.logger, this.entityName, 'methodName', async () => {
 *     return await this.db.select()...
 *   });
 */
export async function withQueryLogging<T>(
    logger: QueryLogger,
    entityName: string,
    methodName: string,
    fn: () => Promise<T>
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
