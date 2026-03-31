CREATE TABLE IF NOT EXISTS `design` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `sort_order` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_design_workspace` ON `design` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_design_project` ON `design` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_design_sort` ON `design` (`project_id`,`sort_order`);
