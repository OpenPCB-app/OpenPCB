-- MCP actor provenance on write proposals. Chats are presentation containers
-- and must not define write ownership: an MCP proposal records WHO proposed
-- it (the client key and the per-session instance id from the MCP identity
-- headers), and ownership checks — awaiting a proposal, undoing a change it
-- landed — compare these columns. NULL for in-app and cloud proposals.
ALTER TABLE assistant_write_proposal ADD COLUMN actor_client_key TEXT;
--> statement-breakpoint
ALTER TABLE assistant_write_proposal ADD COLUMN actor_instance_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_write_proposal_actor
  ON assistant_write_proposal(actor_client_key, actor_instance_id, design_id)
  WHERE actor_instance_id IS NOT NULL;
