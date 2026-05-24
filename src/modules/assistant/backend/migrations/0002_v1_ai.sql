-- Assistant v1 schema upgrade. Brings legacy 0000+0001 DBs and fresh installs to v1.
-- Idempotent additions only; no drops. Old `assistant_task_tool_event` is left in place
-- (orphaned but harmless); new code reads from `assistant_tool_event`.

-- Chat: add prompt preset.
ALTER TABLE assistant_chat ADD COLUMN prompt_preset_id TEXT NOT NULL DEFAULT 'strict-grounded';
--> statement-breakpoint

-- Message: native OpenAI tool-call fields.
ALTER TABLE assistant_message ADD COLUMN tool_call_id TEXT;
--> statement-breakpoint
ALTER TABLE assistant_message ADD COLUMN tool_calls_json TEXT;
--> statement-breakpoint
ALTER TABLE assistant_message ADD COLUMN tool_name TEXT;
--> statement-breakpoint

-- Settings: prompt preset default, context size preference, raw-debug toggle.
ALTER TABLE assistant_settings ADD COLUMN default_prompt_preset_id TEXT NOT NULL DEFAULT 'strict-grounded';
--> statement-breakpoint
ALTER TABLE assistant_settings ADD COLUMN context_size_preference TEXT NOT NULL DEFAULT 'medium';
--> statement-breakpoint
ALTER TABLE assistant_settings ADD COLUMN allow_raw_tool_data INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Context bindings (new).
CREATE TABLE IF NOT EXISTS assistant_context_binding (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES assistant_chat(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  label TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_context_binding_chat ON assistant_context_binding(chat_id);
--> statement-breakpoint

-- Provider capabilities cache (new).
CREATE TABLE IF NOT EXISTS assistant_provider_capability (
  provider_id TEXT PRIMARY KEY REFERENCES assistant_provider_config(id) ON DELETE CASCADE,
  streaming INTEGER NOT NULL DEFAULT 1,
  tool_calling INTEGER NOT NULL DEFAULT 0,
  model_list INTEGER NOT NULL DEFAULT 0,
  vision INTEGER,
  json_mode INTEGER,
  max_context_tokens INTEGER,
  checked_at TEXT,
  warning TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint

-- Tool events v2 (new table, supersedes legacy assistant_task_tool_event).
CREATE TABLE IF NOT EXISTS assistant_tool_event (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES assistant_chat(id) ON DELETE CASCADE,
  task_id TEXT,
  message_id TEXT,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_tool_event_chat ON assistant_tool_event(chat_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_tool_event_message ON assistant_tool_event(message_id);
