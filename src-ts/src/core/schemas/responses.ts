/**
 * API Response Schemas
 * 
 * Standard response wrappers following the ApiResponse pattern.
 */
import { z } from './base';

/**
 * Create a success response wrapper for a given data schema
 */
export const ApiSuccessResponse = <T extends z.ZodTypeAny>(dataSchema: T) =>
    z.object({
        ok: z.literal(true),
        data: dataSchema,
    });

/**
 * Standard error response schema
 */
export const ApiErrorResponse = z.object({
    ok: z.literal(false),
    error: z.object({
        code: z.string().openapi({ example: 'NOT_FOUND' }),
        message: z.string().openapi({ example: 'Resource not found' }),
        details: z.unknown().optional(),
    }),
}).openapi('ApiErrorResponse');

/**
 * Helper to create wrapped response schema for OpenAPI
 */
export const wrapResponse = <T extends z.ZodTypeAny>(dataSchema: T, ref: string) =>
    z.object({
        ok: z.literal(true),
        data: dataSchema,
    }).openapi(ref);

/**
 * Deleted response schema
 */
export const DeletedResponseSchema = z.object({
    deleted: z.literal(true),
}).openapi('DeletedResponse');
