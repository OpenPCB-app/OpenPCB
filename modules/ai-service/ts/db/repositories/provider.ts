import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import {
  provider,
  type Provider,
  type NewProvider,
  type ProviderConfig,
} from "../schema/provider";
import { eq } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class ProviderRepository {
  constructor(
    private db: BunSQLiteDatabase<typeof schema>,
    private logger: QueryLogger,
  ) {}

  async findAll(): Promise<Provider[]> {
    return withQueryLogging(this.logger, "Provider", "findAll", async () => {
      return await this.db.select().from(provider);
    });
  }

  async findByName(name: string): Promise<Provider | null> {
    return withQueryLogging(this.logger, "Provider", "findByName", async () => {
      const result = await this.db
        .select()
        .from(provider)
        .where(eq(provider.name, name))
        .limit(1);
      return result[0] ?? null;
    });
  }

  async findEnabled(): Promise<Provider[]> {
    return withQueryLogging(
      this.logger,
      "Provider",
      "findEnabled",
      async () => {
        return await this.db
          .select()
          .from(provider)
          .where(eq(provider.isEnabled, true));
      },
    );
  }

  async findAvailable(): Promise<Provider[]> {
    return withQueryLogging(
      this.logger,
      "Provider",
      "findAvailable",
      async () => {
        return await this.db
          .select()
          .from(provider)
          .where(eq(provider.isAvailable, true));
      },
    );
  }

  async upsert(data: NewProvider): Promise<Provider> {
    return withQueryLogging(this.logger, "Provider", "upsert", async () => {
      await this.db
        .insert(provider)
        .values({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: provider.name,
          set: { ...data, updatedAt: new Date() },
        });

      return (await this.findByName(data.name))!;
    });
  }

  async updateHealth(
    name: string,
    isAvailable: boolean,
    error?: string,
  ): Promise<void> {
    return withQueryLogging(
      this.logger,
      "Provider",
      "updateHealth",
      async () => {
        await this.db
          .update(provider)
          .set({
            isAvailable,
            healthError: error ?? null,
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(provider.name, name));
      },
    );
  }

  async updateConfig(
    name: string,
    config: ProviderConfig,
  ): Promise<Provider | null> {
    return withQueryLogging(
      this.logger,
      "Provider",
      "updateConfig",
      async () => {
        await this.db
          .update(provider)
          .set({
            config,
            updatedAt: new Date(),
          })
          .where(eq(provider.name, name));
        return await this.findByName(name);
      },
    );
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    return withQueryLogging(this.logger, "Provider", "setEnabled", async () => {
      await this.db
        .update(provider)
        .set({
          isEnabled: enabled,
          updatedAt: new Date(),
        })
        .where(eq(provider.name, name));
    });
  }

  async delete(name: string): Promise<void> {
    return withQueryLogging(this.logger, "Provider", "delete", async () => {
      await this.db.delete(provider).where(eq(provider.name, name));
    });
  }
}
