-- Build intent (P4): the resolved BOM + required nets captured at planning time
-- from library_resolve_bom, keyed by chat + task. The Definition-of-Done verifier
-- (verification/run-dod.ts) reads this back to check the finished design against
-- what the user actually asked for (every BOM item placed, every required net wired).
--
-- One intent row per (chat_id, task_id); items hang off it. Re-running the resolve
-- for the same task replaces the prior intent (delete-then-insert) so the latest
-- plan wins.

CREATE TABLE IF NOT EXISTS assistant_build_intent (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES assistant_chat(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_build_intent_chat_task
  ON assistant_build_intent(chat_id, task_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_build_intent_chat
  ON assistant_build_intent(chat_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_build_intent_item (
  id TEXT PRIMARY KEY,
  build_intent_id TEXT NOT NULL REFERENCES assistant_build_intent(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  component_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  value TEXT,
  required_nets_json TEXT NOT NULL DEFAULT '[]'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_build_intent_item_parent
  ON assistant_build_intent_item(build_intent_id);
