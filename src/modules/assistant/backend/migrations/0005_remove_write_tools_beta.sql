-- Remove the historical assistant_settings.enable_write_tools_beta column.
-- Write tools are no longer feature-gated; write safety is enforced by tool
-- behavior and tool_execution_policy.

CREATE TABLE assistant_settings_next (
  id TEXT PRIMARY KEY,
  default_provider_id TEXT NOT NULL,
  tool_execution_policy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  default_prompt_preset_id TEXT NOT NULL DEFAULT 'strict-grounded',
  context_size_preference TEXT NOT NULL DEFAULT 'medium',
  allow_raw_tool_data INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO assistant_settings_next (
  id,
  default_provider_id,
  tool_execution_policy,
  created_at,
  updated_at,
  default_prompt_preset_id,
  context_size_preference,
  allow_raw_tool_data
)
SELECT
  id,
  default_provider_id,
  tool_execution_policy,
  created_at,
  updated_at,
  default_prompt_preset_id,
  context_size_preference,
  allow_raw_tool_data
FROM assistant_settings;
--> statement-breakpoint
DROP TABLE assistant_settings;
--> statement-breakpoint
ALTER TABLE assistant_settings_next RENAME TO assistant_settings;
