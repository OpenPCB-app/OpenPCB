/**
 * ModelLoadCache - TTL-based In-Memory Cache for Model Load Status
 *
 * Replaces database persistence for model load tracking.
 * Provider is the source of truth - cache avoids redundant checks.
 *
 * TTL Configuration:
 * - Cloud (openai, anthropic): Infinite (always loaded)
 * - Server (ollama, lmstudio): 30s
 * - Local (llamacpp, mlx): 60s
 *
 * See: TASK_SYSTEM_SPECIFICATION.md
 */

import type { ProviderRegistry } from '../../kernel/providers/registry';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  isLoaded: boolean;
  cachedAt: number;
  ttlMs: number;
}

/**
 * Lock entry for deduplicating concurrent model load requests
 */
interface LoadLockEntry {
  taskId: string;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Result of acquiring a load lock
 */
export interface LoadLockResult {
  /** Whether this is a new load (true) or waiting on existing load (false) */
  isNew: boolean;
  /** Task ID of the load task (may be existing or new) */
  taskId: string;
  /** Promise that resolves when load completes */
  loadPromise: Promise<void>;
}

/**
 * Provider with optional model load check capability
 */
interface ModelLoadAwareProvider {
  id: string;
  config: { type: string };
  isModelLoaded?(model: string): Promise<boolean>;
}

/**
 * Provider type classification for TTL determination
 */
type ProviderCategory = 'cloud' | 'server' | 'local';

// ─── Constants ───────────────────────────────────────────────────────────────

const TTL_MS: Record<ProviderCategory, number> = {
  cloud: Infinity,   // Never expires - cloud models always available
  server: 30_000,    // 30 seconds - Ollama, LMStudio can unload models
  local: 60_000,     // 60 seconds - local process, less volatile
};

/**
 * Provider name → category mapping
 */
const PROVIDER_CATEGORIES: Record<string, ProviderCategory> = {
  // Cloud providers (always loaded)
  openai: 'cloud',
  anthropic: 'cloud',
  groq: 'cloud',
  together: 'cloud',
  fireworks: 'cloud',
  openrouter: 'cloud',
  deepseek: 'cloud',

  // Server providers (model loading required)
  ollama: 'server',
  lmstudio: 'server',

  // Local providers (binary execution)
  llamacpp: 'local',
  'llama.cpp': 'local',
  mlx: 'local',
  local: 'local',
};

// ─── Implementation ──────────────────────────────────────────────────────────

export class ModelLoadCache {
  private cache = new Map<string, CacheEntry>();
  private providerRegistry: ProviderRegistry | null = null;

  // Load lock map: "provider:model" -> LoadLockEntry
  // Used to deduplicate concurrent model load requests
  private loadLocks = new Map<string, LoadLockEntry>();

  /**
   * Set provider registry reference
   * Must be called after ProviderRegistry is initialized
   */
  setProviderRegistry(registry: ProviderRegistry): void {
    this.providerRegistry = registry;
  }

  /**
   * Check if model is loaded (uses TTL cache)
   *
   * For cloud providers, always returns true.
   * For server/local, checks cache first, then queries provider.
   */
  async isLoaded(provider: string, model: string): Promise<boolean> {
    const category = this.getProviderCategory(provider);

    // Cloud providers are always "loaded"
    if (category === 'cloud') {
      return true;
    }

    const key = this.getCacheKey(provider, model);
    const entry = this.cache.get(key);

    // Cache hit and not expired
    if (entry && this.isValid(entry)) {
      return entry.isLoaded;
    }

    // Cache miss or expired - check with provider
    const isLoaded = await this.checkProviderModelLoaded(provider, model);

    // Cache result
    this.cache.set(key, {
      isLoaded,
      cachedAt: Date.now(),
      ttlMs: TTL_MS[category],
    });

    return isLoaded;
  }

  /**
   * Force refresh cache entry (bypass TTL)
   */
  async refresh(provider: string, model: string): Promise<boolean> {
    // Delete existing entry
    this.cache.delete(this.getCacheKey(provider, model));

    // Re-check
    return this.isLoaded(provider, model);
  }

  /**
   * Mark model as loaded in cache
   * Called after LoadTask completes successfully
   */
  markLoaded(provider: string, model: string): void {
    const category = this.getProviderCategory(provider);
    if (category === 'cloud') return; // No-op for cloud

    const key = this.getCacheKey(provider, model);
    this.cache.set(key, {
      isLoaded: true,
      cachedAt: Date.now(),
      ttlMs: TTL_MS[category],
    });
  }

  /**
   * Mark model as unloaded (remove from cache)
   */
  markUnloaded(provider: string, model: string): void {
    this.cache.delete(this.getCacheKey(provider, model));
  }

  /**
   * Clear all cache entries for a provider
   * Useful when provider reconnects or restarts
   */
  clearProvider(provider: string): void {
    const prefix = `${provider}:`;
    const keysToDelete = Array.from(this.cache.keys()).filter(key => key.startsWith(prefix));
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    // Also clear any pending locks
    for (const lock of this.loadLocks.values()) {
      lock.reject(new Error('Cache cleared'));
    }
    this.loadLocks.clear();
  }

  /**
   * Get cache stats (for debugging)
   */
  getStats(): { size: number; entries: string[]; pendingLoads: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
      pendingLoads: Array.from(this.loadLocks.keys()),
    };
  }

  // ─── Load Lock Methods ────────────────────────────────────────────────────

  /**
   * Acquire a load lock for a model.
   *
   * If no lock exists, creates one and returns isNew=true.
   * If a lock already exists, returns isNew=false with the existing taskId.
   *
   * @param provider Provider ID
   * @param model Model name
   * @param taskId Task ID to associate with this lock (only used if isNew=true)
   * @returns LoadLockResult with status and promise
   */
  acquireLoadLock(provider: string, model: string, taskId: string): LoadLockResult {
    const key = this.getCacheKey(provider, model);
    const existingLock = this.loadLocks.get(key);

    if (existingLock) {
      // Lock exists - return existing lock info
      return {
        isNew: false,
        taskId: existingLock.taskId,
        loadPromise: existingLock.promise,
      };
    }

    // Create new lock
    let resolvePromise: () => void;
    let rejectPromise: (error: Error) => void;

    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const lockEntry: LoadLockEntry = {
      taskId,
      promise,
      resolve: resolvePromise!,
      reject: rejectPromise!,
    };

    this.loadLocks.set(key, lockEntry);

    return {
      isNew: true,
      taskId,
      loadPromise: promise,
    };
  }

  /**
   * Release a load lock on success
   * Marks model as loaded in cache and resolves waiting promises
   */
  releaseLoadLock(provider: string, model: string): void {
    const key = this.getCacheKey(provider, model);
    const lock = this.loadLocks.get(key);

    if (lock) {
      // Mark as loaded in cache
      this.markLoaded(provider, model);
      // Resolve waiting promises
      lock.resolve();
      // Remove lock
      this.loadLocks.delete(key);
    }
  }

  /**
   * Release a load lock on failure
   * Rejects waiting promises without marking as loaded
   */
  releaseLoadLockWithError(provider: string, model: string, error: Error): void {
    const key = this.getCacheKey(provider, model);
    const lock = this.loadLocks.get(key);

    if (lock) {
      // Reject waiting promises
      lock.reject(error);
      // Remove lock
      this.loadLocks.delete(key);
    }
  }

  /**
   * Check if there's an active load lock for a model
   */
  hasLoadLock(provider: string, model: string): boolean {
    return this.loadLocks.has(this.getCacheKey(provider, model));
  }

  /**
   * Get pending load task ID if lock exists
   */
  getLoadTaskId(provider: string, model: string): string | null {
    const lock = this.loadLocks.get(this.getCacheKey(provider, model));
    return lock?.taskId ?? null;
  }

  // ─── Private Methods ─────────────────────────────────────────────────────

  private getCacheKey(provider: string, model: string): string {
    return `${provider}:${model}`;
  }

  private isValid(entry: CacheEntry): boolean {
    // Infinite TTL never expires
    if (entry.ttlMs === Infinity) return true;
    return Date.now() - entry.cachedAt < entry.ttlMs;
  }

  private getProviderCategory(provider: string): ProviderCategory {
    const normalized = provider.toLowerCase();
    return PROVIDER_CATEGORIES[normalized] ?? 'server';
  }

  /**
   * Check with provider if model is loaded
   * Falls back to false if provider doesn't support the check
   */
  private async checkProviderModelLoaded(
    providerId: string,
    model: string
  ): Promise<boolean> {
    if (!this.providerRegistry) {
      console.warn('[ModelLoadCache] No provider registry, assuming not loaded');
      return false;
    }

    // Registry.get() is async - must await
    const provider = await this.providerRegistry.get(providerId as any) as ModelLoadAwareProvider | undefined;
    if (!provider) {
      console.warn(`[ModelLoadCache] Provider ${providerId} not found`);
      return false;
    }

    // If provider implements isModelLoaded, use it
    if (typeof provider.isModelLoaded === 'function') {
      try {
        return await provider.isModelLoaded(model);
      } catch (err) {
        console.error(`[ModelLoadCache] Error checking model load status:`, err);
        return false;
      }
    }

    // Provider doesn't support model load check - assume not loaded
    // This will trigger a LoadTask which is safe (idempotent)
    return false;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let modelLoadCacheInstance: ModelLoadCache | null = null;

export function getModelLoadCache(): ModelLoadCache {
  if (!modelLoadCacheInstance) {
    modelLoadCacheInstance = new ModelLoadCache();
  }
  return modelLoadCacheInstance;
}

export function initializeModelLoadCache(registry: ProviderRegistry): ModelLoadCache {
  const cache = getModelLoadCache();
  cache.setProviderRegistry(registry);
  return cache;
}
