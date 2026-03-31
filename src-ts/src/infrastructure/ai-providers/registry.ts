/**
 * ProviderRegistry - V2 Kernel
 *
 * Manages registration and lookup of provider engines.
 * Singleton pattern for global access.
 */

import type { ProviderId, ProviderConfig, ProviderInfo } from "@shared/types";
import { PROVIDERS, PROVIDER_REQUIRES_API_KEY } from "@shared/types";
import type {
  KernelProviderEngine,
  ProviderEngineFactory,
  ProviderStatus,
} from "./engine.ts";
import type { ProviderRepository } from "../../db/repositories/provider";

export interface RegistryConfig {
  providers?: Partial<Record<ProviderId, ProviderConfig>>;
  defaultTimeout?: number;
  repository?: ProviderRepository;
}

/** Provider registration entry */
interface RegistryEntry {
  factory: ProviderEngineFactory;
  engine: KernelProviderEngine | null;
  config: ProviderConfig;
  /** Cached status from last health check */
  lastStatus: ProviderStatus | null;
  /** Timestamp of last status check */
  statusCheckedAt: number;
}

/** Status cache TTL (30 seconds) */
const STATUS_CACHE_TTL = 30000;

/**
 * Provider Registry
 *
 * Manages provider engine lifecycle:
 * - Registration via factory functions
 * - Lazy initialization on first use
 * - Configuration management
 * - Status checking
 */
export class ProviderRegistry {
  private entries = new Map<ProviderId, RegistryEntry>();
  private config: RegistryConfig;
  private repository?: ProviderRepository;

  constructor(config: RegistryConfig = {}) {
    this.config = config;
    this.repository = config.repository;
  }

  /**
   * Register a provider engine factory.
   * Engine is created lazily on first access.
   */
  register(providerId: ProviderId, factory: ProviderEngineFactory): void {
    if (this.entries.has(providerId)) {
      console.warn(
        `[ProviderRegistry] Overwriting existing provider: ${providerId}`,
      );
    }

    const providerConfig = this.config.providers?.[providerId] || {};

    this.entries.set(providerId, {
      factory,
      engine: null,
      config: {
        timeout: this.config.defaultTimeout,
        ...providerConfig,
      },
      lastStatus: null,
      statusCheckedAt: 0,
    });

    this.persistProvider(providerId);
    console.log(`[ProviderRegistry] Registered provider: ${providerId}`);
  }

  /**
   * Get a provider engine by ID.
   * Creates and initializes engine on first access.
   */
  async get(providerId: ProviderId): Promise<KernelProviderEngine | null> {
    const entry = this.entries.get(providerId);
    if (!entry) {
      return null;
    }

    // Lazy initialization
    if (!entry.engine) {
      entry.engine = entry.factory();
      await entry.engine.initialize(entry.config);
    }

    return entry.engine;
  }

  /**
   * Get engine synchronously (must be pre-initialized).
   * Returns null if not registered or not initialized.
   */
  getSync(providerId: ProviderId): KernelProviderEngine | null {
    const entry = this.entries.get(providerId);
    return entry?.engine || null;
  }

  /**
   * Check if a provider is registered.
   */
  has(providerId: ProviderId): boolean {
    return this.entries.has(providerId);
  }

  /**
   * Check if a provider is initialized.
   */
  isInitialized(providerId: ProviderId): boolean {
    const entry = this.entries.get(providerId);
    return entry?.engine !== null;
  }

  /**
   * List all registered provider IDs.
   */
  list(): ProviderId[] {
    return Array.from(this.entries.keys());
  }

  /**
   * List all registered providers with info.
   */
  listProviders(): ProviderInfo[] {
    return this.list()
      .map((id) => PROVIDERS.find((p) => p.id === id))
      .filter((p): p is ProviderInfo => p !== undefined);
  }

  /**
   * Get status of all registered providers.
   * Uses cached status if fresh, otherwise refreshes.
   */
  async checkAllStatus(): Promise<Map<ProviderId, ProviderStatus>> {
    const results = new Map<ProviderId, ProviderStatus>();

    for (const providerId of this.entries.keys()) {
      const status = await this.getStatus(providerId);
      results.set(providerId, status);
    }

    return results;
  }

  /**
   * Get cached status for a provider if fresh.
   * Returns null if no cached status or cache is stale.
   */
  getCachedStatus(providerId: ProviderId): ProviderStatus | null {
    const entry = this.entries.get(providerId);
    if (!entry || !entry.lastStatus) {
      return null;
    }

    // Check if cache is still fresh
    if (Date.now() - entry.statusCheckedAt < STATUS_CACHE_TTL) {
      return entry.lastStatus;
    }

    return null;
  }

  /**
   * Get status for a provider, using cache if fresh.
   * Forces a fresh check if cache is stale or missing.
   */
  async getStatus(providerId: ProviderId): Promise<ProviderStatus> {
    const cached = this.getCachedStatus(providerId);
    if (cached) {
      return cached;
    }

    return this.refreshStatus(providerId);
  }

  /**
   * Force refresh status for a provider.
   * Updates cache and returns fresh status.
   */
  async refreshStatus(providerId: ProviderId): Promise<ProviderStatus> {
    const entry = this.entries.get(providerId);
    if (!entry) {
      return {
        available: false,
        message: "Provider not registered",
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      const engine = await this.get(providerId);
      if (engine) {
        const status = await engine.checkStatus();
        entry.lastStatus = status;
        entry.statusCheckedAt = Date.now();
        await this.persistHealth(providerId, status.available, status.message);
        return status;
      } else {
        const status: ProviderStatus = {
          available: false,
          message: "Engine not found",
          checkedAt: new Date().toISOString(),
        };
        entry.lastStatus = status;
        entry.statusCheckedAt = Date.now();
        await this.persistHealth(providerId, false, status.message);
        return status;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status: ProviderStatus = {
        available: false,
        message,
        checkedAt: new Date().toISOString(),
      };
      entry.lastStatus = status;
      entry.statusCheckedAt = Date.now();
      await this.persistHealth(providerId, false, message);
      return status;
    }
  }

  private async persistHealth(
    providerId: ProviderId,
    available: boolean,
    error?: string,
  ): Promise<void> {
    if (!this.repository) return;
    try {
      await this.repository.updateHealth(
        providerId,
        available,
        available ? undefined : error,
      );
    } catch {
      // Silently ignore DB errors for health persistence
    }
  }

  private persistProvider(providerId: ProviderId): void {
    if (!this.repository) return;
    const info = PROVIDERS.find((p) => p.id === providerId);
    const providerType = this.requiresApiKey(providerId) ? "cloud" : "local";
    this.repository
      .upsert({
        name: providerId,
        type: providerType,
        displayName: info?.name ?? providerId,
        isEnabled: true,
        isAvailable: false,
      })
      .catch(() => {});
  }

  /**
   * Update configuration for a provider.
   * Re-initializes engine if already created.
   */
  async configure(
    providerId: ProviderId,
    config: ProviderConfig,
  ): Promise<void> {
    const entry = this.entries.get(providerId);
    if (!entry) {
      throw new Error(`Provider not registered: ${providerId}`);
    }

    entry.config = {
      ...entry.config,
      ...config,
    };

    // Re-initialize if engine exists
    if (entry.engine) {
      await entry.engine.initialize(entry.config);
    }
  }

  /**
   * Set API key for a provider.
   */
  async setApiKey(providerId: ProviderId, apiKey: string): Promise<void> {
    await this.configure(providerId, { apiKey });
  }

  /**
   * Set OAuth token for a provider.
   */
  async setOAuthToken(providerId: ProviderId, oauthToken: string): Promise<void> {
    await this.configure(providerId, { oauthToken });
  }

  /**
   * Check if provider requires API key.
   */
  requiresApiKey(providerId: ProviderId): boolean {
    return PROVIDER_REQUIRES_API_KEY[providerId] ?? true;
  }

  /**
   * Dispose all engines.
   */
  dispose(): void {
    for (const [providerId, entry] of this.entries) {
      if (entry.engine) {
        entry.engine.dispose();
        entry.engine = null;
        console.log(`[ProviderRegistry] Disposed provider: ${providerId}`);
      }
    }
  }

  /**
   * Dispose a specific provider.
   */
  disposeProvider(providerId: ProviderId): void {
    const entry = this.entries.get(providerId);
    if (entry?.engine) {
      entry.engine.dispose();
      entry.engine = null;
      console.log(`[ProviderRegistry] Disposed provider: ${providerId}`);
    }
  }

  /**
   * Unregister a provider.
   */
  unregister(providerId: ProviderId): boolean {
    const entry = this.entries.get(providerId);
    if (entry) {
      if (entry.engine) {
        entry.engine.dispose();
      }
      this.entries.delete(providerId);
      console.log(`[ProviderRegistry] Unregistered provider: ${providerId}`);
      return true;
    }
    return false;
  }
}

/** Global registry instance (singleton) */
let globalRegistry: ProviderRegistry | null = null;

/**
 * Get or create global provider registry.
 */
export function getProviderRegistry(config?: RegistryConfig): ProviderRegistry {
  if (!globalRegistry) {
    globalRegistry = new ProviderRegistry(config);
  }
  return globalRegistry;
}

/**
 * Create a new provider registry (non-singleton).
 */
export function createProviderRegistry(
  config?: RegistryConfig,
): ProviderRegistry {
  return new ProviderRegistry(config);
}

/**
 * Reset global registry (for testing).
 */
export function resetProviderRegistry(): void {
  if (globalRegistry) {
    globalRegistry.dispose();
    globalRegistry = null;
  }
}
