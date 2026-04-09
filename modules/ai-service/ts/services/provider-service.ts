import type { ProviderRegistry } from '../../infrastructure/ai-providers/registry';
import type { ProviderApiKeyStore } from '../../infrastructure/ai-providers/api-key-store';
import type { ProviderId, ProviderInfo, ProviderDetail } from '@shared/types';
import { MODELS, PROVIDERS } from '@shared/types';
import type { LoadedModel, ProviderStatus } from '../../infrastructure/ai-providers/engine';
import { NotFoundError, BusinessError } from '../../core/errors';

/**
 * ProviderService interface
 * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
 */
export interface IProviderService {
    listProviders(): Promise<ProviderInfo[]>;
    getProvider(id: ProviderId): Promise<ProviderDetail>;
    checkHealth(id: ProviderId): Promise<ProviderStatus>;
    getLoadedModels(id: ProviderId): Promise<LoadedModel[]>;
    setApiKey(id: ProviderId, apiKey: string): Promise<void>;
    removeApiKey(id: ProviderId): Promise<void>;
    hasApiKey(id: ProviderId): Promise<boolean>;
}

/**
 * ProviderService - AI provider business logic
 */
export class ProviderService implements IProviderService {
    constructor(
        private registry: ProviderRegistry,
        private apiKeyStore: ProviderApiKeyStore,
    ) { }

    /**
     * List all available providers with status
     * Performs health checks in parallel for efficiency
     */
    async listProviders(): Promise<ProviderInfo[]> {
        const providers = this.registry.listProviders();

        // Parallel status check for all providers using cached status when available
        const statusPromises = providers.map(async (p) => {
            try {
                // Use registry's cached status if fresh, otherwise refresh
                const status = await this.registry.getStatus(p.id);
                return { id: p.id, status };
            } catch {
                return {
                    id: p.id,
                    status: {
                        available: false,
                        message: 'Health check failed',
                        checkedAt: new Date().toISOString()
                    }
                };
            }
        });

        const statusResults = await Promise.all(statusPromises);
        const statusMap = new Map(statusResults.map(s => [s.id, s.status]));

        return providers.map(p => ({
            id: p.id,
            name: p.name,
            requiresApiKey: this.registry.requiresApiKey(p.id),
            available: statusMap.get(p.id)?.available ?? false,
            status: statusMap.get(p.id),
        }));
    }

    /**
     * Get provider details with models
     * @throws NotFoundError if provider doesn't exist
     * @throws BusinessError if provider engine fails
     */
    async getProvider(id: ProviderId): Promise<ProviderDetail> {
        const providerInfo = PROVIDERS.find((provider) => provider.id === id);
        let engine = null;
        try {
            engine = await this.registry.get(id);
        } catch (error) {
            return {
                id,
                name: providerInfo?.name ?? id,
                requiresApiKey: this.registry.requiresApiKey(id),
                available: false,
                status: {
                    available: false,
                    message: error instanceof Error ? error.message : 'Provider initialization failed',
                    checkedAt: new Date().toISOString(),
                },
                models: MODELS.filter((model) => model.providerId === id),
            };
        }

        if (!engine) {
            throw new NotFoundError('Provider', id);
        }

        try {
            const status = await engine.checkStatus();
            const models = await engine.listModels();

            return {
                id,
                name: engine.name || id,
                requiresApiKey: this.registry.requiresApiKey(id),
                available: status.available,
                status,
                models: models,
            };
        } catch (error) {
            return {
                id,
                name: engine.name || id,
                requiresApiKey: this.registry.requiresApiKey(id),
                available: false,
                status: {
                    available: false,
                    message: error instanceof Error ? error.message : 'Provider details unavailable',
                    checkedAt: new Date().toISOString(),
                },
                models: MODELS.filter((model) => model.providerId === id),
            };
        }
    }

    /**
     * Check provider health/availability
     * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
     * @throws NotFoundError if provider doesn't exist
     * @throws BusinessError if health check fails
     */
    async checkHealth(id: ProviderId): Promise<ProviderStatus> {
        let engine = null;
        try {
            engine = await this.registry.get(id);
        } catch (error) {
            return {
                available: false,
                message: error instanceof Error ? error.message : 'Health check failed',
                checkedAt: new Date().toISOString(),
            };
        }

        if (!engine) {
            throw new NotFoundError('Provider', id);
        }

        try {
            return await engine.checkStatus();
        } catch (error) {
            // Return unavailable status instead of throwing for health checks
            return {
                available: false,
                message: error instanceof Error ? error.message : 'Health check failed',
                checkedAt: new Date().toISOString(),
            };
        }
    }

    /**
     * Get loaded models for a provider (server/local providers)
     * Cloud providers return empty array as models are always "loaded"
     * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
     * @throws NotFoundError if provider doesn't exist
     * @throws BusinessError if listing fails
     */
    async getLoadedModels(id: ProviderId): Promise<LoadedModel[]> {
        const engine = await this.registry.get(id);
        if (!engine) {
            throw new NotFoundError('Provider', id);
        }

        try {
            return await engine.getLoadedModels();
        } catch (error) {
            throw new BusinessError(
                `Failed to get loaded models: ${error instanceof Error ? error.message : 'Unknown error'}`,
                { providerId: id }
            );
        }
    }

    /**
     * Set API key for a provider (runtime only).
     */
    async setApiKey(id: ProviderId, apiKey: string): Promise<void> {
        if (!this.registry.has(id)) {
            throw new NotFoundError('Provider', id);
        }

        await this.apiKeyStore.set(id, apiKey);
        await this.registry.setApiKey(id, apiKey);
    }

    /**
     * Remove API key for a provider (runtime only).
     */
    async removeApiKey(id: ProviderId): Promise<void> {
        if (!this.registry.has(id)) {
            throw new NotFoundError('Provider', id);
        }

        await this.apiKeyStore.delete(id);
        this.registry.disposeProvider(id);
        await this.registry.configure(id, { apiKey: undefined });
    }

    /**
     * Check if a provider API key is stored.
     */
    async hasApiKey(id: ProviderId): Promise<boolean> {
        if (!this.registry.has(id)) {
            throw new NotFoundError('Provider', id);
        }

        return this.apiKeyStore.has(id);
    }
}
