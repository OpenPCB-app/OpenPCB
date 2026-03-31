/**
 * Provider Registry
 * 
 * Manages the lifecycle of registered providers.
 * Implements the Registry pattern for provider management.
 */

import type { Provider } from './types';

/**
 * Provider Registry - manages provider lifecycle
 * 
 * Responsibilities:
 * - Provider registration/unregistration
 * - Provider lookup by ID
 * - Provider listing with filters
 */
export class ProviderRegistry {
    private providers = new Map<string, Provider>();

    /**
     * Register a provider
     * @param provider Provider instance to register
     * @throws Error if provider ID already exists
     */
    register(provider: Provider): void {
        if (this.providers.has(provider.id)) {
            throw new Error(`Provider ${provider.id} already registered`);
        }

        this.providers.set(provider.id, provider);
        console.log(`[ProviderRegistry] Registered provider: ${provider.id}`);
    }

    /**
     * Unregister a provider and shut it down
     * @param id Provider ID to unregister
     */
    async unregister(id: string): Promise<void> {
        const provider = this.providers.get(id);
        if (!provider) return;

        await provider.shutdown();
        this.providers.delete(id);
        console.log(`[ProviderRegistry] Unregistered provider: ${id}`);
    }

    /**
     * Get provider by ID
     * @param id Provider ID
     * @returns Provider instance or undefined
     */
    get(id: string): Provider | undefined {
        return this.providers.get(id);
    }

    /**
     * Get provider by ID or throw error
     * @param id Provider ID
     * @returns Provider instance
     * @throws Error if provider not found
     */
    getOrThrow(id: string): Provider {
        const provider = this.get(id);
        if (!provider) {
            throw new Error(`Provider ${id} not found`);
        }
        return provider;
    }

    /**
     * List all providers with optional filtering
     * @param filter Optional filter criteria
     * @returns Array of matching providers
     */
    list(filter?: { enabled?: boolean; type?: string }): Provider[] {
        let providers = Array.from(this.providers.values());

        if (filter?.enabled !== undefined) {
            providers = providers.filter(p => p.config.enabled === filter.enabled);
        }

        if (filter?.type) {
            providers = providers.filter(p => p.config.type === filter.type);
        }

        return providers;
    }

    /**
     * Get all provider IDs
     * @returns Array of provider IDs
     */
    getIds(): string[] {
        return Array.from(this.providers.keys());
    }

    /**
     * Check if provider exists
     * @param id Provider ID
     * @returns True if provider exists
     */
    has(id: string): boolean {
        return this.providers.has(id);
    }

    /**
     * Get count of registered providers
     * @returns Number of registered providers
     */
    count(): number {
        return this.providers.size;
    }
}

/**
 * Singleton registry instance
 */
let registryInstance: ProviderRegistry | null = null;

/**
 * Get the global provider registry instance
 * @returns Singleton ProviderRegistry instance
 */
export function getProviderRegistry(): ProviderRegistry {
    if (!registryInstance) {
        registryInstance = new ProviderRegistry();
    }
    return registryInstance;
}
