CREATE TABLE IF NOT EXISTS `content_edit_lock` (
  `id` text PRIMARY KEY NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `edit_id` text NOT NULL,
  `acquired_by` text,
  `acquired_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cel_edit` ON `content_edit_lock` (`edit_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cel_expires` ON `content_edit_lock` (`expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_cel_target` ON `content_edit_lock` (`target_type`,`target_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `content_edit_snapshot` (
  `id` text PRIMARY KEY NOT NULL,
  `edit_id` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `content_before` text NOT NULL,
  `mode` text NOT NULL,
  `selection_info` text,
  `instruction` text NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `content_after` text,
  `tokens_used` text,
  `error` text,
  `workspace_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  `expires_at` integer,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ces_edit` ON `content_edit_snapshot` (`edit_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ces_target` ON `content_edit_snapshot` (`target_type`,`target_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ces_status` ON `content_edit_snapshot` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ces_workspace` ON `content_edit_snapshot` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ces_expires` ON `content_edit_snapshot` (`expires_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ces_target_status` ON `content_edit_snapshot` (`target_type`,`target_id`,`status`);
