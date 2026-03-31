CREATE TABLE IF NOT EXISTS `file` (
	`id` text PRIMARY KEY NOT NULL,
	`blob_id` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`workspace_id` text,
	`project_id` text,
	`space_id` text,
	`tags` text,
	`permissions` text,
	`metadata` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`trashed_at` integer,
	`trashed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`blob_id`) REFERENCES `file_blob`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_blob` ON `file` (`blob_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_workspace` ON `file` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_project` ON `file` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_space` ON `file` (`space_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_status` ON `file` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_trashed_at` ON `file` (`trashed_at`);

CREATE TABLE IF NOT EXISTS `module_writer_document` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`content_engine` text DEFAULT 'tiptap' NOT NULL,
	`content_version` integer DEFAULT 1 NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `module_writer_version` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`source` text NOT NULL,
	`title` text,
	`content_snapshot` text NOT NULL,
	`thread_id` text,
	`message_id` text,
	`edit_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `module_writer_document`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `module_writer_thread_link` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`is_closed` integer DEFAULT false NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `module_writer_document`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wd_workspace` ON `module_writer_document` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wd_deleted` ON `module_writer_document` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wd_title` ON `module_writer_document` (`title`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wd_updated` ON `module_writer_document` (`updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wv_document` ON `module_writer_version` (`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wv_source` ON `module_writer_version` (`source`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wv_created` ON `module_writer_version` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wv_thread` ON `module_writer_version` (`thread_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wtl_document` ON `module_writer_thread_link` (`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wtl_chat` ON `module_writer_thread_link` (`chat_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wtl_order` ON `module_writer_thread_link` (`document_id`,`is_pinned`,`display_order`);

ALTER TABLE `module_brainstorming_node` ADD COLUMN `summary_rich` text;
