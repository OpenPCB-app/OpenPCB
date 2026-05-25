-- Deterministic per-chat message order. Timestamps can tie when a user
-- message and assistant placeholder are created in the same millisecond.

ALTER TABLE assistant_message ADD COLUMN message_index INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE assistant_message
SET message_index = (
  SELECT COUNT(*) - 1
  FROM assistant_message AS previous
  WHERE previous.chat_id = assistant_message.chat_id
    AND (
      previous.created_at < assistant_message.created_at
      OR (
        previous.created_at = assistant_message.created_at
        AND previous.id <= assistant_message.id
      )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_message_chat_index
  ON assistant_message(chat_id, message_index);
