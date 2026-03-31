UPDATE `message`
SET `parent_message_id` = NULL
WHERE `parent_message_id` IN (
	SELECT `id` FROM `message` WHERE `role` = 'tool'
);
--> statement-breakpoint
DELETE FROM `message`
WHERE `role` = 'tool';
--> statement-breakpoint
UPDATE `chat`
SET
	`message_count` = (
		SELECT COUNT(*)
		FROM `message` m
		WHERE m.`chat_id` = `chat`.`id`
			AND m.`deleted_at` IS NULL
	),
	`last_message_at` = (
		SELECT MAX(m.`created_at`)
		FROM `message` m
		WHERE m.`chat_id` = `chat`.`id`
			AND m.`deleted_at` IS NULL
	),
	`updated_at` = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER);
