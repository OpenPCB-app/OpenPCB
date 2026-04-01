CREATE TABLE `design_sheet` (
  `id` text PRIMARY KEY NOT NULL,
  `design_id` text NOT NULL,
  `sheet_index` integer NOT NULL DEFAULT 0,
  `title` text NOT NULL DEFAULT 'Sheet 1',
  `content` text NOT NULL,
  `content_hash` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_design_sheet_design` ON `design_sheet` (`design_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_design_sheet_design_sheet` ON `design_sheet` (`design_id`, `sheet_index`);
