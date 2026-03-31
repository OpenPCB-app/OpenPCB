CREATE TABLE `task_tool_event` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`task_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`args` text,
	`result` text,
	`is_error` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_tool_event_assistant_seq` ON `task_tool_event` (`assistant_message_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_task_tool_event_chat_created` ON `task_tool_event` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_task_tool_event_task` ON `task_tool_event` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_tool_event_tool_call` ON `task_tool_event` (`tool_call_id`);--> statement-breakpoint
ALTER TABLE `task` ADD `assistant_message_id` text;--> statement-breakpoint
CREATE INDEX `idx_task_assistant_message` ON `task` (`assistant_message_id`);