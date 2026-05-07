-- Schematic primitives (GND/PWR/NET_PORTAL ports). No FK on `design_id` is
-- intentional and matches every other designer_* table on this branch — the
-- module persists ECS state as JSON blobs and uses application-level cascade
-- on design deletion (see designer/backend/projection-world.ts and the design-
-- delete path). Do not add ON DELETE CASCADE here without auditing the rest
-- of the designer migrations as a single change.
CREATE TABLE `designer_schematic_primitives` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`kind` text NOT NULL,
	`position_x_nm` integer NOT NULL,
	`position_y_nm` integer NOT NULL,
	`rotation_deg` integer NOT NULL DEFAULT 0,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `designer_schematic_primitives_design_id_idx` ON `designer_schematic_primitives` (`design_id`);
--> statement-breakpoint
CREATE INDEX `designer_schematic_primitives_design_kind_idx` ON `designer_schematic_primitives` (`design_id`, `kind`);
