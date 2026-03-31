/**
 * Kernel Initialization
 *
 * Bootstraps kernel systems (providers, tasks).
 */

import { getProviderRegistry } from '../infrastructure/ai-providers/registry';
import { registerAllEngines } from '../infrastructure/ai-providers/engines/mod';

/**
 * Initialize kernel systems
 *
 * Responsibilities:
 * - Bootstrap provider registry
 * - Register provider engines (OpenAI, Ollama)
 * - Bootstrap task manager (auto-initialized via singleton)
 */
export async function initializeKernel(): Promise<void> {
    console.log('[Kernel] Initializing...');

    // Initialize provider engine registry (infrastructure layer)
    const providerRegistry = getProviderRegistry();
    console.log('[Kernel] Provider registry initialized');

    // Register all available provider engines
    registerAllEngines(providerRegistry);
    console.log(`[Kernel] Providers registered: ${providerRegistry.list().length}`);

    // Task manager is auto-initialized via singleton in tasks/instance.ts
    console.log('[Kernel] Task manager initialized');

    console.log('[Kernel] Kernel initialization complete');
}
