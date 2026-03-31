CREATE TABLE `mcp_server` (
	`id` text PRIMARY KEY NOT NULL,
	`alias` text NOT NULL,
	`display_name` text,
	`transport` text NOT NULL,
	`command` text,
	`args` text,
	`env` text,
	`url` text,
	`headers` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ck_mcp_server_alias_not_blank" CHECK(length(trim("mcp_server"."alias")) > 0),
	CONSTRAINT "ck_mcp_server_transport_required_fields" CHECK((
        ("mcp_server"."transport" = 'stdio' and "mcp_server"."command" is not null and length(trim("mcp_server"."command")) > 0)
        or
        ("mcp_server"."transport" = 'http' and "mcp_server"."url" is not null and length(trim("mcp_server"."url")) > 0)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_server_alias` ON `mcp_server` (`alias`);--> statement-breakpoint
CREATE INDEX `idx_mcp_server_transport` ON `mcp_server` (`transport`);--> statement-breakpoint
CREATE INDEX `idx_mcp_server_enabled` ON `mcp_server` (`enabled`);
