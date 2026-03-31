/**
 * Time utilities for consistent timestamp handling
 */

/**
 * Current Unix timestamp in milliseconds
 */
export const now = (): number => Date.now();

/**
 * Current ISO 8601 timestamp string
 */
export const nowISO = (): string => new Date().toISOString();

/**
 * Convert milliseconds to ISO string
 */
export const toISO = (ms: number): string => new Date(ms).toISOString();

/**
 * Convert ISO string to milliseconds
 */
export const fromISO = (iso: string): number => new Date(iso).getTime();
