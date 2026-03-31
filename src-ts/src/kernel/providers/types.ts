/**
 * Provider Types and Interfaces
 * 
 * Defines the core abstractions for the provider system.
 * Providers are plugins that provide AI/LLM capabilities.
 */

/**
 * Provider capability flags
 */
export interface ProviderCapabilities {
    /** Supports streaming responses */
    streaming: boolean;
    /** Supports function/tool calling */
    functionCalling: boolean;
    /** Supports vision/image inputs */
    vision: boolean;
    /** Supports text embeddings */
    embeddings: boolean;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
    /** Unique provider identifier */
    id: string;
    /** Provider type */
    type: 'openai' | 'anthropic' | 'local' | 'custom';
    /** Human-readable name */
    name: string;
    /** Whether provider is enabled */
    enabled: boolean;
    /** API key (if required) */
    apiKey?: string;
    /** Custom endpoint URL (if required) */
    endpoint?: string;
    /** Default model to use */
    model?: string;
    /** Provider capabilities */
    capabilities: ProviderCapabilities;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Provider interface - all providers must implement this
 */
export interface Provider {
    /** Unique identifier */
    readonly id: string;
    /** Provider configuration */
    readonly config: ProviderConfig;
    /** Provider capabilities */
    readonly capabilities: ProviderCapabilities;

    /**
     * Initialize the provider
     * Called once when provider is registered
     */
    initialize(): Promise<void>;

    /**
     * Shutdown the provider
     * Called when provider is unregistered or app shuts down
     */
    shutdown(): Promise<void>;

    /**
     * Check if provider is healthy and available
     * @returns Health status with optional message
     */
    health(): Promise<{ healthy: boolean; message?: string }>;
}

/**
 * Provider factory - creates provider instances from configuration
 */
export interface ProviderFactory {
    /**
     * Create a provider instance from configuration
     * @param config Provider configuration
     * @returns Initialized provider instance
     */
    create(config: ProviderConfig): Provider;

    /**
     * Check if this factory supports the given provider type
     * @param type Provider type to check
     * @returns True if supported
     */
    supports(type: string): boolean;
}
