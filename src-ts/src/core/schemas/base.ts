/**
 * OpenAPI Registry Base
 * 
 * Provides shared OpenAPI registry singleton and extended Zod instance
 * for use across all schema definitions.
 */
import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with OpenAPI support
extendZodWithOpenApi(z);

// Shared OpenAPI registry for all schema registrations
export const apiRegistry = new OpenAPIRegistry();

// Re-export extended Zod
export { z };
