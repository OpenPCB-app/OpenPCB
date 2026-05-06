CREATE TABLE `designer_pcb_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_pcb_entities_design_id_idx` ON `designer_pcb_entities` (`design_id`);
--> statement-breakpoint
CREATE INDEX `designer_pcb_entities_design_kind_idx` ON `designer_pcb_entities` (`design_id`, `kind`);
