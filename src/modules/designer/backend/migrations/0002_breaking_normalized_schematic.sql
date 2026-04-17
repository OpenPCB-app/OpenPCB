DROP TABLE IF EXISTS `designer_schematic_labels`;
--> statement-breakpoint
DROP TABLE IF EXISTS `designer_schematic_wires`;
--> statement-breakpoint
DROP TABLE IF EXISTS `designer_schematic_pins`;
--> statement-breakpoint
DROP TABLE IF EXISTS `designer_schematic_parts`;
--> statement-breakpoint
DROP TABLE IF EXISTS `designer_command_log`;
--> statement-breakpoint
DROP TABLE IF EXISTS `designer_entities`;
--> statement-breakpoint
CREATE TABLE `designer_schematic_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`component_id` text NOT NULL,
	`reference` text NOT NULL,
	`value` text NOT NULL,
	`position_x_nm` integer NOT NULL,
	`position_y_nm` integer NOT NULL,
	`rotation_deg` integer DEFAULT 0 NOT NULL,
	`mirrored` integer DEFAULT 0 NOT NULL,
	`symbol_snapshot_json` text NOT NULL,
	`footprint_snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_schematic_parts_design_id_idx` ON `designer_schematic_parts` (`design_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `designer_schematic_parts_design_ref_uq` ON `designer_schematic_parts` (`design_id`, `reference`);
--> statement-breakpoint
CREATE TABLE `designer_schematic_pins` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`part_id` text NOT NULL,
	`origin_pin_key` text NOT NULL,
	`number` text,
	`name` text NOT NULL,
	`electrical_type` text NOT NULL,
	`unit` integer NOT NULL,
	`local_x_nm` integer NOT NULL,
	`local_y_nm` integer NOT NULL,
	`world_x_nm` integer NOT NULL,
	`world_y_nm` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_schematic_pins_design_id_idx` ON `designer_schematic_pins` (`design_id`);
--> statement-breakpoint
CREATE INDEX `designer_schematic_pins_part_id_idx` ON `designer_schematic_pins` (`part_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `designer_schematic_pins_part_origin_key_uq` ON `designer_schematic_pins` (`part_id`, `origin_pin_key`);
--> statement-breakpoint
CREATE TABLE `designer_schematic_wires` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`source_pin_id` text NOT NULL,
	`target_pin_id` text NOT NULL,
	`points_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_schematic_wires_design_id_idx` ON `designer_schematic_wires` (`design_id`);
--> statement-breakpoint
CREATE INDEX `designer_schematic_wires_source_pin_idx` ON `designer_schematic_wires` (`source_pin_id`);
--> statement-breakpoint
CREATE INDEX `designer_schematic_wires_target_pin_idx` ON `designer_schematic_wires` (`target_pin_id`);
--> statement-breakpoint
CREATE TABLE `designer_schematic_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`text` text NOT NULL,
	`x_nm` integer NOT NULL,
	`y_nm` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_schematic_labels_design_id_idx` ON `designer_schematic_labels` (`design_id`);
--> statement-breakpoint
CREATE TABLE `designer_command_log` (
	`command_id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`session_id` text NOT NULL,
	`command_type` text NOT NULL,
	`command_json` text NOT NULL,
	`result_json` text NOT NULL,
	`issued_at` integer NOT NULL,
	`applied_revision` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_command_log_design_id_idx` ON `designer_command_log` (`design_id`);
