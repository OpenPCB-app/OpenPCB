CREATE TABLE `bookmark` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`chat_id` text,
	`message_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_bookmark_workspace` ON `bookmark` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_bookmark_chat` ON `bookmark` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_bookmark_message` ON `bookmark` (`message_id`);--> statement-breakpoint
CREATE TABLE `chat` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`folder_id` text,
	`title` text,
	`summary` text,
	`provider` text,
	`model` text,
	`system_prompt` text,
	`is_pinned` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`sort_order` integer,
	`icon_name` text,
	`icon_color` text,
	`category` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_chat_workspace` ON `chat` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_project` ON `chat` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_folder` ON `chat` (`folder_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_provider` ON `chat` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_chat_category` ON `chat` (`category`);--> statement-breakpoint
CREATE INDEX `idx_chat_last_message` ON `chat` (`workspace_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_pinned` ON `chat` (`workspace_id`,`is_pinned`);--> statement-breakpoint
CREATE INDEX `idx_chat_archived` ON `chat` (`workspace_id`,`is_archived`);--> statement-breakpoint
CREATE TABLE `content_edit_lock` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`edit_id` text NOT NULL,
	`acquired_by` text,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cel_edit` ON `content_edit_lock` (`edit_id`);--> statement-breakpoint
CREATE INDEX `idx_cel_expires` ON `content_edit_lock` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_cel_target` ON `content_edit_lock` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `content_edit_snapshot` (
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
CREATE INDEX `idx_ces_edit` ON `content_edit_snapshot` (`edit_id`);--> statement-breakpoint
CREATE INDEX `idx_ces_target` ON `content_edit_snapshot` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_ces_status` ON `content_edit_snapshot` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ces_workspace` ON `content_edit_snapshot` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_ces_expires` ON `content_edit_snapshot` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_ces_target_status` ON `content_edit_snapshot` (`target_type`,`target_id`,`status`);--> statement-breakpoint
CREATE TABLE `favorite` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`chat_id` text,
	`sort_order` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_favorite_workspace_chat` ON `favorite` (`workspace_id`,`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_favorite_sort` ON `favorite` (`workspace_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `file_blob` (
	`id` text PRIMARY KEY NOT NULL,
	`checksum` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`mime_type` text NOT NULL,
	`storage_path` text NOT NULL,
	`ref_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_blob_checksum_unique` ON `file_blob` (`checksum`);--> statement-breakpoint
CREATE INDEX `idx_file_blob_checksum` ON `file_blob` (`checksum`);--> statement-breakpoint
CREATE TABLE `file_retention_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`rules` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_retention_policy_workspace` ON `file_retention_policy` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_retention_policy_enabled` ON `file_retention_policy` (`enabled`);--> statement-breakpoint
CREATE TABLE `file_version` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`blob_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_by` text,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blob_id`) REFERENCES `file_blob`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_file_version_file` ON `file_version` (`file_id`);--> statement-breakpoint
CREATE INDEX `idx_file_version_number` ON `file_version` (`file_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `file` (
	`id` text PRIMARY KEY NOT NULL,
	`blob_id` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`space_id` text,
	`tags` text DEFAULT '[]',
	`permissions` text,
	`metadata` text,
	`status` text DEFAULT 'active' NOT NULL,
	`trashed_at` integer,
	`trashed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`blob_id`) REFERENCES `file_blob`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_file_blob` ON `file` (`blob_id`);--> statement-breakpoint
CREATE INDEX `idx_file_workspace` ON `file` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_file_project` ON `file` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_file_space` ON `file` (`space_id`);--> statement-breakpoint
CREATE INDEX `idx_file_status` ON `file` (`status`);--> statement-breakpoint
CREATE INDEX `idx_file_trashed_at` ON `file` (`trashed_at`);--> statement-breakpoint
CREATE TABLE `folder` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`project_id` text,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`sort_order` integer,
	`is_expanded` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_folder_workspace` ON `folder` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_folder_project` ON `folder` (`project_id`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`settings` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`icon` text,
	`color` text,
	`sort_order` integer,
	`ai_config` text,
	`rag_config` text,
	`preferences` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_workspace` ON `project` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_project_status` ON `project` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`parent_message_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`task_id` text,
	`provider` text,
	`model` text,
	`token_count` text,
	`tokens` text,
	`branch_index` integer DEFAULT 0 NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`generation_params` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_message_chat` ON `message` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_message_parent` ON `message` (`parent_message_id`);--> statement-breakpoint
CREATE INDEX `idx_message_active_path` ON `message` (`chat_id`,`is_active`,`depth`);--> statement-breakpoint
CREATE INDEX `idx_message_branch` ON `message` (`parent_message_id`,`branch_index`);--> statement-breakpoint
CREATE INDEX `idx_message_task` ON `message` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_message_chat_created` ON `message` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 5 NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`depends_on` text,
	`waiting_tasks` text DEFAULT '[]',
	`payload` text NOT NULL,
	`result` text,
	`result_raw` text,
	`input` text,
	`output` text,
	`error` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`metadata` text,
	`request_id` text,
	`workspace_id` text,
	`project_id` text,
	`chat_id` text,
	FOREIGN KEY (`depends_on`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_task_workspace` ON `task` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_task_project` ON `task` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_task_chat` ON `task` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_task_status` ON `task` (`status`);--> statement-breakpoint
CREATE INDEX `idx_task_type` ON `task` (`type`);--> statement-breakpoint
CREATE INDEX `idx_task_type_status` ON `task` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_task_provider_model` ON `task` (`provider`,`model`);--> statement-breakpoint
CREATE INDEX `idx_task_depends_on` ON `task` (`depends_on`);--> statement-breakpoint
CREATE INDEX `idx_task_priority_status` ON `task` (`priority`,`status`);--> statement-breakpoint
CREATE INDEX `idx_task_created` ON `task` (`created_at`);--> statement-breakpoint
CREATE TABLE `task_chunk` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`seq` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_chunk_task_seq` ON `task_chunk` (`task_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_task_chunk_task` ON `task_chunk` (`task_id`);--> statement-breakpoint
CREATE TABLE `chat_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_tag_unique` ON `chat_tag` (`chat_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_tag_chat` ON `chat_tag` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_tag_tag` ON `chat_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `project_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_tag_unique` ON `project_tag` (`project_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_project_tag_project` ON `project_tag` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_tag_tag` ON `project_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`color` text,
	`sort_order` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tag_workspace_project_name` ON `tag` (`workspace_id`, COALESCE(`project_id`, ''), `name`);--> statement-breakpoint
CREATE INDEX `idx_tag_workspace` ON `tag` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_tag_project` ON `tag` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_tag_sort` ON `tag` (`workspace_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `upload_session` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`space_id` text,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`total_size` integer NOT NULL,
	`uploaded_size` integer DEFAULT 0 NOT NULL,
	`chunk_size` integer NOT NULL,
	`total_chunks` integer NOT NULL,
	`uploaded_chunks` text DEFAULT '[]',
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer NOT NULL,
	`file_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_upload_session_workspace` ON `upload_session` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_upload_session_status` ON `upload_session` (`status`);--> statement-breakpoint
CREATE INDEX `idx_upload_session_expires` ON `upload_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `provider_api_key` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`encrypted_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_oauth` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer,
	`account_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider` (
	`name` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`display_name` text,
	`config` text,
	`is_available` integer DEFAULT false NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`last_health_check` integer,
	`health_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_provider_type` ON `provider` (`type`);--> statement-breakpoint
CREATE INDEX `idx_provider_available` ON `provider` (`is_available`);--> statement-breakpoint
CREATE TABLE `usage_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`limit_cents` real NOT NULL,
	`warn_at_percent` integer DEFAULT 90 NOT NULL,
	`period` text DEFAULT 'monthly' NOT NULL,
	`period_start_at` integer NOT NULL,
	`current_usage_cents` real DEFAULT 0 NOT NULL,
	`action_on_limit` text DEFAULT 'warn' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_budget_workspace` ON `usage_budget` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_budget_active` ON `usage_budget` (`is_active`);--> statement-breakpoint
CREATE INDEX `idx_budget_period_start` ON `usage_budget` (`period_start_at`);--> statement-breakpoint
CREATE TABLE `usage_record` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`chat_id` text,
	`task_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_cents` real DEFAULT 0 NOT NULL,
	`prompt_price_per_million` real,
	`completion_price_per_million` real,
	`request_type` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_usage_workspace` ON `usage_record` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_project` ON `usage_record` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_chat` ON `usage_record` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_task` ON `usage_record` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_provider_model` ON `usage_record` (`provider`,`model`);--> statement-breakpoint
CREATE INDEX `idx_usage_created` ON `usage_record` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_workspace_date` ON `usage_record` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `message_mention` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`display_text` text NOT NULL,
	`snapshot_data` text NOT NULL,
	`snapshot_created_at` text NOT NULL,
	`entity_version` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mention_message` ON `message_mention` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_mention_entity` ON `message_mention` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_mention_entity_type` ON `message_mention` (`entity_type`);--> statement-breakpoint
CREATE TABLE `module_brainstorming_ai_job` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`node_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input_snapshot_json` text,
	`output_json` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_baj_board` ON `module_brainstorming_ai_job` (`board_id`);--> statement-breakpoint
CREATE INDEX `idx_baj_node` ON `module_brainstorming_ai_job` (`node_id`);--> statement-breakpoint
CREATE INDEX `idx_baj_status` ON `module_brainstorming_ai_job` (`status`);--> statement-breakpoint
CREATE TABLE `module_brainstorming_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`node_id` text,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ba_board` ON `module_brainstorming_artifacts` (`board_id`);--> statement-breakpoint
CREATE INDEX `idx_ba_node` ON `module_brainstorming_artifacts` (`node_id`);--> statement-breakpoint
CREATE TABLE `module_brainstorming_board` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`description` text,
	`system_prompt_validation` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_bb_workspace` ON `module_brainstorming_board` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_bb_workspace_project` ON `module_brainstorming_board` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_bb_deleted` ON `module_brainstorming_board` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `module_brainstorming_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`parent_comment_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bc_node` ON `module_brainstorming_comment` (`node_id`);--> statement-breakpoint
CREATE INDEX `idx_bc_parent` ON `module_brainstorming_comment` (`parent_comment_id`);--> statement-breakpoint
CREATE TABLE `module_brainstorming_edge` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`from_node` text NOT NULL,
	`to_node` text NOT NULL,
	`type` text DEFAULT 'follows_from' NOT NULL,
	`label` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_be_board` ON `module_brainstorming_edge` (`board_id`);--> statement-breakpoint
CREATE INDEX `idx_be_from` ON `module_brainstorming_edge` (`from_node`);--> statement-breakpoint
CREATE INDEX `idx_be_to` ON `module_brainstorming_edge` (`to_node`);--> statement-breakpoint
CREATE TABLE `module_brainstorming_node` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`type` text DEFAULT 'idea' NOT NULL,
	`title` text NOT NULL,
	`summary_rich` text,
	`content_rich` text,
	`system_prompt_validation` text,
	`tags_json` text,
	`attachments_json` text,
	`color` text,
	`parent_id` text,
	`position_x` real DEFAULT 0 NOT NULL,
	`position_y` real DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`reviewed_parent_version` integer,
	`is_starred` integer DEFAULT false,
	`is_pinned` integer DEFAULT false,
	`is_deleted` integer DEFAULT false,
	`child_count` integer DEFAULT 0,
	`comment_count` integer DEFAULT 0,
	`validation_json` text,
	`ai_job_ids_json` text,
	`chat_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bn_board` ON `module_brainstorming_node` (`board_id`);--> statement-breakpoint
CREATE INDEX `idx_bn_parent` ON `module_brainstorming_node` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_bn_deleted` ON `module_brainstorming_node` (`is_deleted`);--> statement-breakpoint
CREATE TABLE `module_knowledge_page` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`parent_id` text,
	`is_project_root` integer DEFAULT false,
	`order_key` text NOT NULL,
	`title` text NOT NULL,
	`icon` text,
	`properties_json` text DEFAULT '{}',
	`content_engine` text DEFAULT 'tiptap' NOT NULL,
	`content_version` integer DEFAULT 1 NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_kp_workspace_project` ON `module_knowledge_page` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_kp_parent` ON `module_knowledge_page` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_kp_deleted` ON `module_knowledge_page` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_kp_title` ON `module_knowledge_page` (`title`);--> statement-breakpoint
CREATE INDEX `idx_kp_order` ON `module_knowledge_page` (`parent_id`,`order_key`);--> statement-breakpoint

CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  content,
  content='message',
  content_rowid='rowid'
);
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS message_fts_insert AFTER INSERT ON message BEGIN
  INSERT INTO message_fts(rowid, content)
  SELECT NEW.rowid,
    CASE json_extract(NEW.content, '$.type')
      WHEN 'text' THEN COALESCE(json_extract(NEW.content, '$.text'), '')
      WHEN 'multipart' THEN COALESCE(json_extract(NEW.content, '$.parts[0].text'), '')
      ELSE ''
    END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS message_fts_update AFTER UPDATE OF content ON message BEGIN
  DELETE FROM message_fts WHERE rowid = OLD.rowid;
  INSERT INTO message_fts(rowid, content)
  SELECT NEW.rowid,
    CASE json_extract(NEW.content, '$.type')
      WHEN 'text' THEN COALESCE(json_extract(NEW.content, '$.text'), '')
      WHEN 'multipart' THEN COALESCE(json_extract(NEW.content, '$.parts[0].text'), '')
      ELSE ''
    END;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS message_fts_delete AFTER DELETE ON message BEGIN
  DELETE FROM message_fts WHERE rowid = OLD.rowid;
END;
--> statement-breakpoint

INSERT INTO message_fts(rowid, content)
SELECT rowid,
  CASE json_extract(content, '$.type')
    WHEN 'text' THEN COALESCE(json_extract(content, '$.text'), '')
    WHEN 'multipart' THEN COALESCE(json_extract(content, '$.parts[0].text'), '')
    ELSE ''
  END
FROM message
WHERE NOT EXISTS (SELECT 1 FROM message_fts WHERE message_fts.rowid = message.rowid);
--> statement-breakpoint

INSERT INTO `provider` (
  `name`,
  `type`,
  `display_name`,
  `is_enabled`,
  `is_available`,
  `created_at`,
  `updated_at`
) VALUES
  ('openai', 'cloud', 'OpenAI', true, false, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('openrouter', 'cloud', 'OpenRouter', true, false, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('ollama', 'server', 'Ollama', true, false, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('codex', 'cloud', 'Codex', true, false, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('github-copilot', 'cloud', 'GitHub Copilot', true, false, strftime('%s','now') * 1000, strftime('%s','now') * 1000)
ON CONFLICT(name) DO NOTHING;
