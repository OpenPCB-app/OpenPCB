import type { RouteContext } from '../router';
import type { IProviderService } from '../../domain/services';
import type { ProviderId } from '@shared/types';
import { ResponseBuilder } from '../../core/utils/response-builder';

/**
 * ProviderController - Thin HTTP handler for AI providers
 * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
 */
export class ProviderController {
    constructor(private providerService: IProviderService) { }

    /**
     * GET /api/providers
     */
    async list(_ctx: RouteContext): Promise<Response> {
        const providers = await this.providerService.listProviders();
        return ResponseBuilder.success({ providers });
    }

    /**
     * GET /api/providers/:id
     */
    async get(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id') as ProviderId;
        const provider = await this.providerService.getProvider(id);
        return ResponseBuilder.success({ provider });
    }

    /**
     * GET /api/providers/:id/health
     * Check provider health/availability
     * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
     */
    async health(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id') as ProviderId;
        const health = await this.providerService.checkHealth(id);
        return ResponseBuilder.success({
            provider: id,
            ...health,
        });
    }

    /**
     * GET /api/providers/:id/loaded
     * List currently loaded models for a provider (server/local providers)
     * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
     */
    async loaded(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id') as ProviderId;
        const models = await this.providerService.getLoadedModels(id);
        return ResponseBuilder.success({
            provider: id,
            models,
        });
    }

    /**
     * POST /api/providers/:id/api-key
     * Set provider API key (persisted + runtime).
     */
    async setApiKey(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id') as ProviderId;
        const body = await ctx.req.json();
        const apiKey = body?.apiKey;
        if (!apiKey || typeof apiKey !== 'string') {
            return ResponseBuilder.badRequest('API key is required');
        }

        await this.providerService.setApiKey(id, apiKey);
        return ResponseBuilder.success({ provider: id, updated: true });
    }

    /**
     * GET /api/providers/:id/api-key
     * Check if provider API key is stored.
     */
    async getApiKeyStatus(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id') as ProviderId;
        const stored = await this.providerService.hasApiKey(id);
        return ResponseBuilder.success({ provider: id, stored });
    }

    /**
     * DELETE /api/providers/:id/api-key
     * Remove provider API key (persisted + runtime).
     */
    async removeApiKey(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id') as ProviderId;
        await this.providerService.removeApiKey(id);
        return ResponseBuilder.success({ provider: id, removed: true });
    }
}
