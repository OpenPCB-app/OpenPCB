/**
 * Provider API Key Repository
 *
 * Handles CRUD operations for provider API keys.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { providerApiKey, type ProviderApiKey } from "../schema/provider-api-key";
import { eq } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class ProviderApiKeyRepository {
  private entityName = "ProviderApiKey";

  constructor(
    private db: BunSQLiteDatabase<typeof schema>,
    private logger: QueryLogger,
  ) {}

  async get(providerId: string): Promise<ProviderApiKey | null> {
    return withQueryLogging(this.logger, this.entityName, "get", async () => {
      const result = await this.db
        .select()
        .from(providerApiKey)
        .where(eq(providerApiKey.providerId, providerId))
        .limit(1);
      return result[0] ?? null;
    });
  }

  async upsert(providerId: string, encryptedKey: string): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, "upsert", async () => {
      const now = new Date();
      await this.db
        .insert(providerApiKey)
        .values({
          providerId,
          encryptedKey,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: providerApiKey.providerId,
          set: {
            encryptedKey,
            updatedAt: now,
          },
        });
    });
  }

  async delete(providerId: string): Promise<boolean> {
    return withQueryLogging(this.logger, this.entityName, "delete", async () => {
      const existing = await this.get(providerId);
      if (!existing) {
        return false;
      }
      await this.db
        .delete(providerApiKey)
        .where(eq(providerApiKey.providerId, providerId));
      return true;
    });
  }

  async has(providerId: string): Promise<boolean> {
    return withQueryLogging(this.logger, this.entityName, "has", async () => {
      const existing = await this.get(providerId);
      return existing !== null;
    });
  }

  async listProviders(): Promise<string[]> {
    return withQueryLogging(this.logger, this.entityName, "listProviders", async () => {
      const rows = await this.db.select({ providerId: providerApiKey.providerId }).from(providerApiKey);
      return rows.map((row) => row.providerId);
    });
  }
}
