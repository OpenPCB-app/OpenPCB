/**
 * Common Schemas
 * 
 * Reusable schema primitives for API definitions.
 */
import { z } from './base';

/**
 * UUIDv7 identifier schema
 */
export const UUIDv7Schema = z.string()
    .uuid()
    .openapi({
        example: '01935c4a-1b2d-7e3f-8c9d-0e1f2a3b4c5d',
        description: 'UUIDv7 identifier'
    });

/**
 * ISO 8601 datetime string schema
 */
export const TimestampSchema = z.string()
    .datetime()
    .openapi({
        example: '2024-01-01T00:00:00.000Z',
        description: 'ISO 8601 datetime string'
    });

/**
 * Pagination query parameters
 */
export const PaginationSchema = z.object({
    page: z.number().int().min(1).default(1).openapi({ example: 1 }),
    limit: z.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
}).openapi('Pagination');

/**
 * Standard ID path parameter
 */
export const IdParamSchema = z.object({
    id: UUIDv7Schema,
}).openapi('IdParam');
