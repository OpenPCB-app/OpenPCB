/**
 * Secrets Store - V2 Kernel
 *
 * Abstraction for secure secret storage.
 * Implementations can use in-memory (dev), environment, or Stronghold (production).
 */

import type { ProviderId } from "@shared/types";

/** Secret key types */
export type SecretKey = `provider.${ProviderId}.apiKey` | `custom.${string}`;

/** Secrets store interface */
export interface SecretsStore {
  /** Get a secret value */
  get(key: SecretKey): Promise<string | undefined>;

  /** Set a secret value */
  set(key: SecretKey, value: string): Promise<void>;

  /** Delete a secret */
  delete(key: SecretKey): Promise<boolean>;

  /** Check if a secret exists */
  has(key: SecretKey): Promise<boolean>;

  /** List all secret keys (not values) */
  keys(): Promise<SecretKey[]>;

  /** Clear all secrets */
  clear(): Promise<void>;
}

/**
 * In-memory secrets store for development/testing.
 */
export class MemorySecretsStore implements SecretsStore {
  private secrets = new Map<SecretKey, string>();

  async get(key: SecretKey): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async set(key: SecretKey, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async delete(key: SecretKey): Promise<boolean> {
    return this.secrets.delete(key);
  }

  async has(key: SecretKey): Promise<boolean> {
    return this.secrets.has(key);
  }

  async keys(): Promise<SecretKey[]> {
    return Array.from(this.secrets.keys());
  }

  async clear(): Promise<void> {
    this.secrets.clear();
  }
}

/**
 * Environment-based secrets store.
 * Reads from environment variables, read-only for set operations.
 */
export class EnvSecretsStore implements SecretsStore {
  private envKeyMap: Record<string, string> = {
    "provider.openai.apiKey": "OPENAI_API_KEY",
    "provider.openrouter.apiKey": "OPENROUTER_API_KEY",
    "provider.ollama.apiKey": "OLLAMA_API_KEY",
    "provider.anthropic.apiKey": "ANTHROPIC_API_KEY",
    "provider.groq.apiKey": "GROQ_API_KEY",
  };

  async get(key: SecretKey): Promise<string | undefined> {
    const envKey = this.envKeyMap[key];
    if (envKey) {
      return process.env[envKey];
    }
    // Custom keys: OpenPCB_SECRET_<key>
    if (key.startsWith("custom.")) {
      const customKey = key.replace("custom.", "").toUpperCase().replace(/\./g, "_");
      return process.env[`OpenPCB_SECRET_${customKey}`];
    }
    return undefined;
  }

  async set(_key: SecretKey, _value: string): Promise<void> {
    console.warn("[SecretsStore] EnvSecretsStore is read-only");
  }

  async delete(_key: SecretKey): Promise<boolean> {
    console.warn("[SecretsStore] EnvSecretsStore is read-only");
    return false;
  }

  async has(key: SecretKey): Promise<boolean> {
    const value = await this.get(key);
    return value !== undefined;
  }

  async keys(): Promise<SecretKey[]> {
    const keys: SecretKey[] = [];
    for (const [secretKey, envKey] of Object.entries(this.envKeyMap)) {
      if (process.env[envKey]) {
        keys.push(secretKey as SecretKey);
      }
    }
    return keys;
  }

  async clear(): Promise<void> {
    console.warn("[SecretsStore] EnvSecretsStore is read-only");
  }
}

/**
 * Composite secrets store that chains multiple stores.
 * Reads from stores in order until a value is found.
 * Writes go to the first writable store.
 */
export class CompositeSecretsStore implements SecretsStore {
  constructor(
    private stores: SecretsStore[],
    private writableStore?: SecretsStore,
  ) {}

  async get(key: SecretKey): Promise<string | undefined> {
    for (const store of this.stores) {
      const value = await store.get(key);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  async set(key: SecretKey, value: string): Promise<void> {
    if (this.writableStore) {
      await this.writableStore.set(key, value);
    } else {
      console.warn("[SecretsStore] No writable store configured");
    }
  }

  async delete(key: SecretKey): Promise<boolean> {
    if (this.writableStore) {
      return this.writableStore.delete(key);
    }
    return false;
  }

  async has(key: SecretKey): Promise<boolean> {
    for (const store of this.stores) {
      if (await store.has(key)) {
        return true;
      }
    }
    return false;
  }

  async keys(): Promise<SecretKey[]> {
    const allKeys = new Set<SecretKey>();
    for (const store of this.stores) {
      const keys = await store.keys();
      for (const key of keys) {
        allKeys.add(key);
      }
    }
    return Array.from(allKeys);
  }

  async clear(): Promise<void> {
    if (this.writableStore) {
      await this.writableStore.clear();
    }
  }
}

/** Create default secrets store based on environment */
export function createSecretsStore(environment: "development" | "production" | "test"): SecretsStore {
  const envStore = new EnvSecretsStore();
  const memoryStore = new MemorySecretsStore();

  if (environment === "test") {
    // Test: memory only
    return memoryStore;
  }

  // Development/Production: env first, memory as fallback/write target
  return new CompositeSecretsStore([envStore, memoryStore], memoryStore);
}

/** Helper to get provider API key */
export async function getProviderApiKey(
  store: SecretsStore,
  providerId: ProviderId,
): Promise<string | undefined> {
  return store.get(`provider.${providerId}.apiKey`);
}

/** Helper to set provider API key */
export async function setProviderApiKey(
  store: SecretsStore,
  providerId: ProviderId,
  apiKey: string,
): Promise<void> {
  await store.set(`provider.${providerId}.apiKey`, apiKey);
}
