/**
 * Provider OAuth Schema
 *
 * Stores OAuth credentials for providers (Codex, GitHub Copilot).
 * Tokens are encrypted before storage.
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { timestamps } from "./base";

export const providerOAuth = sqliteTable("provider_oauth", {
  providerId: text("provider_id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  accountId: text("account_id"),
  ...timestamps,
});

export type ProviderOAuth = typeof providerOAuth.$inferSelect;
export type NewProviderOAuth = typeof providerOAuth.$inferInsert;
