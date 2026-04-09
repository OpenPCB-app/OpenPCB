/**
 * Provider OAuth Repository
 *
 * Handles CRUD operations for provider OAuth credentials.
 * Tokens are encrypted before storage and decrypted on retrieval.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { providerOAuth, type ProviderOAuth } from "../schema/provider-oauth";
import { eq } from "drizzle-orm";
import { withQueryLogging } from "../decorators";
import { ApiKeyCipher } from "../../infrastructure/security/api-key-cipher";

export interface OAuthData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  accountId?: string;
}

export interface DecryptedProviderOAuth {
  providerId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  accountId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ProviderOAuthRepository {
  private entityName = "ProviderOAuth";
  private cipher: ApiKeyCipher;

  constructor(
    private db: BunSQLiteDatabase<typeof schema>,
    private logger: QueryLogger,
  ) {
    this.cipher = new ApiKeyCipher();
  }

  async get(providerId: string): Promise<DecryptedProviderOAuth | null> {
    return withQueryLogging(this.logger, this.entityName, "get", async () => {
      const result = await this.db
        .select()
        .from(providerOAuth)
        .where(eq(providerOAuth.providerId, providerId))
        .limit(1);

      const record = result[0];
      if (!record) {
        return null;
      }

      // Decrypt tokens before returning
      const decryptedAccessToken = await this.cipher.decrypt(record.accessToken);
      const decryptedRefreshToken = record.refreshToken
        ? await this.cipher.decrypt(record.refreshToken)
        : null;

      return {
        providerId: record.providerId,
        accessToken: decryptedAccessToken,
        refreshToken: decryptedRefreshToken,
        expiresAt: record.expiresAt,
        accountId: record.accountId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    });
  }

  async upsert(providerId: string, data: OAuthData): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, "upsert", async () => {
      const now = new Date();

      // Encrypt tokens before storage
      const encryptedAccessToken = await this.cipher.encrypt(data.accessToken);
      const encryptedRefreshToken = data.refreshToken
        ? await this.cipher.encrypt(data.refreshToken)
        : null;

      await this.db
        .insert(providerOAuth)
        .values({
          providerId,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: data.expiresAt ?? null,
          accountId: data.accountId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: providerOAuth.providerId,
          set: {
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            expiresAt: data.expiresAt ?? null,
            accountId: data.accountId ?? null,
            updatedAt: now,
          },
        });
    });
  }

  async delete(providerId: string): Promise<boolean> {
    return withQueryLogging(this.logger, this.entityName, "delete", async () => {
      const existing = await this.db
        .select({ providerId: providerOAuth.providerId })
        .from(providerOAuth)
        .where(eq(providerOAuth.providerId, providerId))
        .limit(1);

      if (existing.length === 0) {
        return false;
      }

      await this.db
        .delete(providerOAuth)
        .where(eq(providerOAuth.providerId, providerId));

      return true;
    });
  }

  async listProviders(): Promise<string[]> {
    return withQueryLogging(this.logger, this.entityName, "listProviders", async () => {
      const rows = await this.db
        .select({ providerId: providerOAuth.providerId })
        .from(providerOAuth);
      return rows.map((row) => row.providerId);
    });
  }

  async isExpired(providerId: string, bufferSeconds = 60): Promise<boolean> {
    return withQueryLogging(this.logger, this.entityName, "isExpired", async () => {
      const result = await this.db
        .select({ expiresAt: providerOAuth.expiresAt })
        .from(providerOAuth)
        .where(eq(providerOAuth.providerId, providerId))
        .limit(1);

      const record = result[0];
      if (!record || !record.expiresAt) {
        // No expiration set = not expired (or no record found)
        return false;
      }

      const now = Date.now();
      const expirationTime = record.expiresAt.getTime();
      const bufferMs = bufferSeconds * 1000;

      return now + bufferMs >= expirationTime;
    });
  }
}
