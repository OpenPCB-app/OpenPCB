/**
 * Provider API Key Store
 *
 * Persists provider API keys in SQLite with local encryption.
 */

import type { ProviderId } from "@shared/types";
import type { DatabaseAccess } from "../../db";
import { ProviderApiKeyRepository } from "../../db/repositories/provider-api-key";
import type { ProviderRegistry } from "./registry";
import { ApiKeyCipher } from "../security/api-key-cipher";

export interface ProviderApiKeyStore {
  get(providerId: ProviderId): Promise<string | null>;
  set(providerId: ProviderId, apiKey: string): Promise<void>;
  delete(providerId: ProviderId): Promise<boolean>;
  has(providerId: ProviderId): Promise<boolean>;
  listProviders(): Promise<ProviderId[]>;
}

export class DbProviderApiKeyStore implements ProviderApiKeyStore {
  private repo: ProviderApiKeyRepository;

  constructor(private db: DatabaseAccess, private cipher: ApiKeyCipher) {
    this.repo = db.providerApiKeys;
  }

  async get(providerId: ProviderId): Promise<string | null> {
    const record = await this.repo.get(providerId);
    if (!record) {
      return null;
    }
    return this.cipher.decrypt(record.encryptedKey);
  }

  async set(providerId: ProviderId, apiKey: string): Promise<void> {
    const encrypted = await this.cipher.encrypt(apiKey);
    await this.repo.upsert(providerId, encrypted);
  }

  async delete(providerId: ProviderId): Promise<boolean> {
    return this.repo.delete(providerId);
  }

  async has(providerId: ProviderId): Promise<boolean> {
    try {
      const apiKey = await this.get(providerId);
      return Boolean(apiKey);
    } catch (error) {
      console.warn(
        `[ProviderApiKeyStore] Failed to decrypt API key for ${providerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  async listProviders(): Promise<ProviderId[]> {
    const providers = await this.repo.listProviders();
    return providers as ProviderId[];
  }
}

export function createProviderApiKeyStore(db: DatabaseAccess): ProviderApiKeyStore {
  const cipher = new ApiKeyCipher();
  return new DbProviderApiKeyStore(db, cipher);
}

export async function hydrateProviderRegistryFromStore(
  registry: ProviderRegistry,
  store: ProviderApiKeyStore,
): Promise<void> {
  let providers: ProviderId[] = [];
  try {
    providers = await store.listProviders();
  } catch (error) {
    console.warn(
      `[ProviderApiKeyStore] Unable to list stored API keys: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }
  for (const providerId of providers) {
    try {
      if (!registry.has(providerId)) {
        continue;
      }
      const apiKey = await store.get(providerId);
      if (apiKey) {
        await registry.configure(providerId, { apiKey });
      }
    } catch (error) {
      console.warn(
        `[ProviderApiKeyStore] Skipping API key for ${providerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
