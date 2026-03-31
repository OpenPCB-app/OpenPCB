/**
 * Provider API Key Schema
 *
 * Stores encrypted API keys for providers.
 */

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./base";

export const providerApiKey = sqliteTable("provider_api_key", {
  providerId: text("provider_id").primaryKey(),
  encryptedKey: text("encrypted_key").notNull(),
  ...timestamps,
});

export type ProviderApiKey = typeof providerApiKey.$inferSelect;
export type NewProviderApiKey = typeof providerApiKey.$inferInsert;
