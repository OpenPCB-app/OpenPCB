/**
 * Logger - Scoped console wrapper
 * Provides module-scoped logging with consistent prefixes
 * Implements the Logger interface from core types
 */

import type { Logger as LoggerInterface } from "shared/types/logger";

export class Logger implements LoggerInterface {
    constructor(private scope: string) { }

    /**
     * Log info message
     */
    info(...args: unknown[]): void {
        console.log(`[${this.scope}]`, ...args);
    }

    /**
     * Log warning message
     */
    warn(...args: unknown[]): void {
        console.warn(`[${this.scope}]`, ...args);
    }

    /**
     * Log error message
     */
    error(...args: unknown[]): void {
        console.error(`[${this.scope}]`, ...args);
    }

    /**
     * Log debug message
     */
    debug(...args: unknown[]): void {
        console.debug(`[${this.scope}]`, ...args);
    }

    /**
     * General log method (aliases to info)
     */
    log(...args: unknown[]): void {
        console.log(`[${this.scope}]`, ...args);
    }
}
