CREATE TABLE `designer_design_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_design_heads_name_idx` ON `designer_design_heads` (`name`);
--> statement-breakpoint
CREATE TABLE `designer_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_entities_design_id_idx` ON `designer_entities` (`design_id`);
--> statement-breakpoint
CREATE TABLE `designer_command_log` (
	`command_id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`session_id` text NOT NULL,
	`command_type` text NOT NULL,
	`issued_at` integer NOT NULL,
	`applied_revision` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_command_log_design_id_idx` ON `designer_command_log` (`design_id`);
