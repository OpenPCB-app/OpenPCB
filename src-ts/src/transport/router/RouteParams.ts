/**
 * Route Parameters - Shared utility for HTTP routing
 * Provides type-safe parameter extraction from route patterns
 */

/**
 * Route parameter extractor
 * Eliminates fragile URL parsing duplications
 */
export class RouteParams {
    constructor(private params: Record<string, string>) { }

    /**
     * Get parameter (returns undefined if missing)
     */
    get(name: string): string | undefined {
        return this.params[name];
    }

    /**
     * Get parameter or throw error
     */
    getOrThrow(name: string): string {
        const value = this.params[name];
        if (!value) {
            throw new Error(`Required parameter "${name}" missing`);
        }
        return value;
    }

    /**
     * Get integer parameter
     */
    getInt(name: string, defaultValue?: number): number {
        const value = this.params[name];
        if (!value) {
            if (defaultValue !== undefined) return defaultValue;
            throw new Error(`Required parameter "${name}" missing`);
        }
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
            throw new Error(`Parameter "${name}" must be an integer`);
        }
        return parsed;
    }

    /**
     * Get all params as object
     */
    all(): Record<string, string> {
        return { ...this.params };
    }
}
