CREATE TABLE IF NOT EXISTS `designer_session_histories` (
  `id` text PRIMARY KEY NOT NULL,
  `design_id` text NOT NULL,
  `session_id` text NOT NULL,
  `undo_stack_json` text NOT NULL,
  `redo_stack_json` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `designer_session_histories_design_session_uq` ON `designer_session_histories` (`design_id`, `session_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `designer_session_histories_design_id_idx` ON `designer_session_histories` (`design_id`);
