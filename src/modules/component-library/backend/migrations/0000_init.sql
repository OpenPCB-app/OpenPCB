CREATE TABLE `component_library_footprints` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `component_library_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`symbol_id` text NOT NULL,
	`footprint_id` text NOT NULL,
	`tags_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `component_library_parts_name_idx` ON `component_library_parts` (`name`);--> statement-breakpoint
CREATE TABLE `component_library_symbols` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL
);
