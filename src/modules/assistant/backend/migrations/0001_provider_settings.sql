ALTER TABLE assistant_chat ADD COLUMN provider_config_id TEXT DEFAULT 'openai';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_provider_config (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT,
  default_model TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_settings (
  id TEXT PRIMARY KEY,
  default_provider_id TEXT NOT NULL,
  tool_execution_policy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_provider_model_cache (
  provider_id TEXT NOT NULL REFERENCES assistant_provider_config(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(provider_id, model_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_provider_config_enabled ON assistant_provider_config(enabled);
