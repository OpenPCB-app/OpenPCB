CREATE TABLE IF NOT EXISTS `components` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_key` text NOT NULL,
	`display_label` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT 'workspace' NOT NULL,
	`symbol_data` text NOT NULL,
	`default_variant_id` text,
	`category_path` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ux_components_scope_canonical_key` ON `components` (`scope`,`canonical_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_components_scope` ON `components` (`scope`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_components_category_path` ON `components` (`category_path`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `component_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`component_id` text NOT NULL,
	`canonical_code` text NOT NULL,
	`human_label` text NOT NULL,
	`imperial_alias` text,
	`metric_alias` text,
	`mount_type` text NOT NULL,
	`dimensions` text,
	`is_default` integer DEFAULT false NOT NULL,
	`pin_remap_table` text,
	`footprint_payload` text,
	`default_footprint_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_variants_component` ON `component_variants` (`component_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_variants_default` ON `component_variants` (`component_id`,`is_default`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ux_component_variants_component_code` ON `component_variants` (`component_id`,`canonical_code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `component_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`component_id` text NOT NULL,
	`design_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_usage_component` ON `component_usage` (`component_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_usage_design` ON `component_usage` (`design_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ux_component_usage_design_component_variant` ON `component_usage` (`design_id`,`component_id`,`variant_id`);
