CREATE TABLE `module_writer_document` (
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
CREATE TABLE `module_writer_version` (
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
CREATE TABLE `module_writer_thread_link` (
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
CREATE INDEX `idx_wd_workspace` ON `module_writer_document` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `idx_wd_deleted` ON `module_writer_document` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX `idx_wd_title` ON `module_writer_document` (`title`);
--> statement-breakpoint
CREATE INDEX `idx_wd_updated` ON `module_writer_document` (`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_wv_document` ON `module_writer_version` (`document_id`);
--> statement-breakpoint
CREATE INDEX `idx_wv_source` ON `module_writer_version` (`source`);
--> statement-breakpoint
CREATE INDEX `idx_wv_created` ON `module_writer_version` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_wv_thread` ON `module_writer_version` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `idx_wtl_document` ON `module_writer_thread_link` (`document_id`);
--> statement-breakpoint
CREATE INDEX `idx_wtl_chat` ON `module_writer_thread_link` (`chat_id`);
--> statement-breakpoint
CREATE INDEX `idx_wtl_order` ON `module_writer_thread_link` (`document_id`,`is_pinned`,`display_order`);
