import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const PROVIDER_TYPES = ["cloud", "server", "local"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const provider = sqliteTable(
  "provider",
  {
    name: text("name").primaryKey(),
    type: text("type", { enum: PROVIDER_TYPES }).notNull(),
    displayName: text("display_name"),
    config: text("config", { mode: "json" }).$type<ProviderConfig>(),
    isAvailable: integer("is_available", { mode: "boolean" })
      .notNull()
      .default(false),
    isEnabled: integer("is_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    lastHealthCheck: integer("last_health_check", { mode: "timestamp_ms" }),
    healthError: text("health_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    typeIdx: index("idx_provider_type").on(table.type),
    availableIdx: index("idx_provider_available").on(table.isAvailable),
  }),
);

export type Provider = typeof provider.$inferSelect;
export type NewProvider = typeof provider.$inferInsert;

export interface ProviderConfig {
  endpoint?: string;
  timeout?: number;
  maxConcurrent?: number;
  customHeaders?: Record<string, string>;
  [key: string]: unknown;
}
