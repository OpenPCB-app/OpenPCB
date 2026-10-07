-- App-owned context references canonical AgentKit chat/run IDs without a cross-database FK.
CREATE TABLE IF NOT EXISTS assistant_native_context_binding (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  label TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_native_context_chat
  ON assistant_native_context_binding(chat_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_native_build_intent (
  chat_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, run_id)
);
--> statement-breakpoint
-- Reservations bind model action IDs to immutable arguments and targets across design scopes.
CREATE TABLE IF NOT EXISTS assistant_native_action (
  actor_scope TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  design_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  argument_fingerprint TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  PRIMARY KEY (actor_scope, chat_id, action_id)
);
