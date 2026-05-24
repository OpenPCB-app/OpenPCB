-- Assistant write proposals. These records stage user-approved write actions;
-- creating a proposal must not mutate designer/library data.

CREATE TABLE IF NOT EXISTS assistant_write_proposal (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES assistant_chat(id) ON DELETE CASCADE,
  tool_event_id TEXT REFERENCES assistant_tool_event(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  design_id TEXT NOT NULL,
  base_revision INTEGER,
  proposal_json TEXT NOT NULL,
  apply_result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_write_proposal_chat ON assistant_write_proposal(chat_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_write_proposal_status ON assistant_write_proposal(status);
