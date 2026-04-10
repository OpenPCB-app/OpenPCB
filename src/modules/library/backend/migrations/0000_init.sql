CREATE TABLE `library_components` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`symbol_id` text NOT NULL,
	`footprint_id` text NOT NULL,
	`tags_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_components_name_idx` ON `library_components` (`name`);--> statement-breakpoint
CREATE TABLE `library_footprints` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_symbols` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL
);
