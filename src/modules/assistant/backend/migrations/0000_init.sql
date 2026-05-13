CREATE TABLE IF NOT EXISTS assistant_chat (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_chat_updated ON assistant_chat(updated_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_message (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES assistant_chat(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  task_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_message_chat_created ON assistant_message(chat_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_task_tool_event (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  assistant_message_id TEXT,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tool_call_id TEXT,
  tool_name TEXT,
  args_json TEXT,
  result_json TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
