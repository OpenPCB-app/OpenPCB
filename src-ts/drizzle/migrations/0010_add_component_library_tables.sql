-- Migration: Component Library Base Tables
-- Creates the base tables for the component library system

CREATE TABLE IF NOT EXISTS `component_family` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_key` text NOT NULL,
	`display_label` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`scope` text NOT NULL,
	`symbol_data` text NOT NULL,
	`default_package_variant_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_family_scope_key` ON `component_family` (`scope`,`canonical_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_family_scope` ON `component_family` (`scope`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `component_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`snapshot` text NOT NULL,
	`published_at` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `component_family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_revision_family` ON `component_revision` (`family_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_revision_family_rev` ON `component_revision` (`family_id`,`revision_number`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `component_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text,
	`wizard_step` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `component_family`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_draft_family` ON `component_draft` (`family_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `component_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`source_file_names` text NOT NULL,
	`source_hashes` text NOT NULL,
	`import_timestamp` text NOT NULL,
	`kicad_identifiers` text NOT NULL,
	`heuristic_decisions` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `component_family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_provenance_family` ON `component_provenance` (`family_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `package_variant` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`canonical_code` text NOT NULL,
	`human_label` text NOT NULL,
	`imperial_alias` text,
	`metric_alias` text,
	`mount_type` text NOT NULL,
	`dimensions` text,
	`is_default` integer DEFAULT false NOT NULL,
	`pin_remap_table` text,
	`default_footprint_option_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `component_family`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_package_variant_family` ON `package_variant` (`family_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_package_variant_family_code` ON `package_variant` (`family_id`,`canonical_code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `footprint_option` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`label` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`kicad_payload` text,
	`default_model_3d_option_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`variant_id`) REFERENCES `package_variant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_footprint_option_variant` ON `footprint_option` (`variant_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `model_3d_option` (
	`id` text PRIMARY KEY NOT NULL,
	`footprint_option_id` text NOT NULL,
	`file_name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`link_status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`footprint_option_id`) REFERENCES `footprint_option`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_model_3d_option_fp` ON `model_3d_option` (`footprint_option_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `manufacturer_offering` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`mpn` text NOT NULL,
	`manufacturer` text NOT NULL,
	`datasheet_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `package_variant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_manufacturer_offering_variant` ON `manufacturer_offering` (`variant_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_manufacturer_offering_mpn` ON `manufacturer_offering` (`mpn`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `preset_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`is_immutable` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_preset_catalog_scope` ON `preset_catalog` (`scope`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `preset_variant` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_id` text NOT NULL,
	`canonical_code` text NOT NULL,
	`human_label` text NOT NULL,
	`imperial_alias` text,
	`metric_alias` text,
	`mount_type` text NOT NULL,
	`typical_dimensions` text,
	`pin_count` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`catalog_id`) REFERENCES `preset_catalog`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_preset_variant_catalog` ON `preset_variant` (`catalog_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_preset_variant_code` ON `preset_variant` (`catalog_id`,`canonical_code`);