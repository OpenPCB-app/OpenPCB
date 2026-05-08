CREATE TABLE `library_component_footprints` (
	`component_id` text NOT NULL,
	`footprint_id` text NOT NULL,
	`is_default` integer NOT NULL DEFAULT 0,
	`variant_label` text NOT NULL,
	`sort_order` integer NOT NULL DEFAULT 0,
	PRIMARY KEY (`component_id`, `footprint_id`),
	FOREIGN KEY (`component_id`) REFERENCES `library_components`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`footprint_id`) REFERENCES `library_footprints`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `library_component_footprints_component_idx` ON `library_component_footprints` (`component_id`);
--> statement-breakpoint
CREATE INDEX `library_component_footprints_default_idx` ON `library_component_footprints` (`component_id`, `is_default`);
