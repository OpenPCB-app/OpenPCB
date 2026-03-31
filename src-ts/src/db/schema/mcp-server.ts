import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { timestamps, uuidPrimaryKey } from "./base";

export const MCP_SERVER_TRANSPORTS = ["stdio", "http"] as const;
export type McpServerTransport = (typeof MCP_SERVER_TRANSPORTS)[number];

export type McpServerHeaders = Record<string, string>;
export type McpServerEnv = Record<string, string>;

export const mcpServer = sqliteTable(
  "mcp_server",
  {
    ...uuidPrimaryKey,
    alias: text("alias").notNull(),
    displayName: text("display_name"),
    transport: text("transport", { enum: MCP_SERVER_TRANSPORTS }).notNull(),
    command: text("command"),
    args: text("args", { mode: "json" }).$type<string[]>(),
    env: text("env", { mode: "json" }).$type<McpServerEnv>(),
    url: text("url"),
    headers: text("headers", { mode: "json" }).$type<McpServerHeaders>(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => ({
    aliasUniqueIdx: uniqueIndex("idx_mcp_server_alias").on(table.alias),
    transportIdx: index("idx_mcp_server_transport").on(table.transport),
    enabledIdx: index("idx_mcp_server_enabled").on(table.enabled),
    aliasNotBlank: check(
      "ck_mcp_server_alias_not_blank",
      sql`length(trim(${table.alias})) > 0`,
    ),
    transportRequiredFields: check(
      "ck_mcp_server_transport_required_fields",
      sql`(
        (${table.transport} = 'stdio' and ${table.command} is not null and length(trim(${table.command})) > 0)
        or
        (${table.transport} = 'http' and ${table.url} is not null and length(trim(${table.url})) > 0)
      )`,
    ),
  }),
);

export type McpServer = typeof mcpServer.$inferSelect;
export type NewMcpServer = typeof mcpServer.$inferInsert;
