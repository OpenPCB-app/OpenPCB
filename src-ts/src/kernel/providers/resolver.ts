/**
 * Provider Resolver
 * 
 * Resolves which provider to use based on selection criteria.
 * Implements the Strategy pattern for provider selection.
 */

import type { Provider } from './types';
import type { ProviderRegistry } from './registry';

/**
 * Provider selection strategy interface
 */
export interface ProviderSelector {
    /**
     * Select a provider from available candidates
     * @param providers Available providers
     * @param context Optional selection context
     * @returns Selected provider or null
     */
    select(providers: Provider[], context?: unknown): Provider | null;
}

/**
 * Default selector - picks first enabled provider
 */
class DefaultSelector implements ProviderSelector {
    select(providers: Provider[]): Provider | null {
        return providers.find(p => p.config.enabled) || null;
    }
}

/**
 * Provider Resolver - resolves which provider to use
 * 
 * Responsibilities:
 * - Provider selection based on criteria
 * - Fallback handling
 * - Future: Load balancing, health-based selection
 */
export class ProviderResolver {
    private selector: ProviderSelector;

    constructor(
        private registry: ProviderRegistry,
        selector?: ProviderSelector
    ) {
        this.selector = selector || new DefaultSelector();
    }

    /**
     * Resolve best provider for the given criteria
     * @param options Selection criteria
     * @returns Selected provider or null if none match
     */
    async resolve(options?: {
        /** Filter by provider type */
        type?: string;
        /** Require specific capability */
        capability?: keyof Provider['capabilities'];
        /** Additional context for selection strategy */
        context?: unknown;
    }): Promise<Provider | null> {
        let candidates = this.registry.list({ enabled: true });

        // Filter by type
        if (options?.type) {
            candidates = candidates.filter(p => p.config.type === options.type);
        }

        // Filter by capability
        if (options?.capability) {
            candidates = candidates.filter(
                p => p.capabilities[options.capability!]
            );
        }

        if (candidates.length === 0) {
            console.warn('[ProviderResolver] No suitable providers found', options);
            return null;
        }

        return this.selector.select(candidates, options?.context);
    }

    /**
     * Resolve provider by ID with optional fallback
     * @param id Provider ID to resolve
     * @param fallback Whether to fallback to any provider if ID not found
     * @returns Resolved provider or null
     */
    async resolveById(
        id: string,
        fallback = true
    ): Promise<Provider | null> {
        const provider = this.registry.get(id);

        if (provider && provider.config.enabled) {
            return provider;
        }

        if (fallback) {
            console.warn(
                `[ProviderResolver] Provider ${id} not available, using fallback`
            );
            return this.resolve();
        }

        return null;
    }

    /**
     * Set custom selector strategy
     * @param selector New selector strategy to use
     */
    setSelector(selector: ProviderSelector): void {
        this.selector = selector;
    }
}

/**
 * Create a provider resolver instance
 * @param registry Provider registry to use
 * @param selector Optional custom selector strategy
 * @returns ProviderResolver instance
 */
export function createProviderResolver(
    registry: ProviderRegistry,
    selector?: ProviderSelector
): ProviderResolver {
    return new ProviderResolver(registry, selector);
}
