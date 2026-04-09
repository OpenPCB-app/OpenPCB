/**
 * Provider Zod Schemas
 * 
 * Defines schemas for provider endpoints with OpenAPI metadata.
 */
import { z } from './base';

// ============================================================================
// Provider Enums
// ============================================================================

export const ProviderIdSchema = z.enum([
    'openai', 'openrouter', 'ollama', 'anthropic', 'groq', 'local'
]).openapi({ example: 'openai', description: 'AI provider identifier' });

// ============================================================================
// Provider Info
// ============================================================================

export const ProviderInfoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().openapi({ example: 'OpenAI' }),
    requiresApiKey: z.boolean(),
    baseURL: z.string().url().optional(),
}).openapi('ProviderInfo');

// ============================================================================
// Model Capabilities
// ============================================================================

export const ModelCapabilitiesSchema = z.object({
    supportsVision: z.boolean(),
    supportsStreaming: z.boolean(),
    supportsReasoning: z.boolean(),
}).openapi('ModelCapabilities');

// ============================================================================
// Model Info
// ============================================================================

export const ModelInfoSchema = z.object({
    id: z.string().openapi({ example: 'gpt-4o' }),
    providerId: ProviderIdSchema,
    name: z.string().openapi({ example: 'GPT-4o' }),
    description: z.string().openapi({ example: 'Most capable OpenAI model' }),
    contextWindow: z.number().int().min(0),
    capabilities: ModelCapabilitiesSchema,
}).openapi('ModelInfo');

// ============================================================================
// Response Schemas
// ============================================================================

export const ProviderResponseSchema = z.object({
    provider: ProviderInfoSchema,
    models: z.array(ModelInfoSchema),
}).openapi('ProviderResponse');

export const ProviderListResponseSchema = z.object({
    providers: z.array(ProviderInfoSchema),
}).openapi('ProviderListResponse');

// ============================================================================
// Type Inference
// ============================================================================

export type ProviderIdType = z.infer<typeof ProviderIdSchema>;
export type ProviderInfoType = z.infer<typeof ProviderInfoSchema>;
export type ModelInfoType = z.infer<typeof ModelInfoSchema>;
