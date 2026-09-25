-- Idempotency is scoped to whoever issued the write, not to the whole design.
--
-- 0010 made (design_id, action_id) unique across every chat. The in-memory
-- dedup only looked inside one chat, so when the two disagreed (the same
-- deterministic action_id from another chat, another MCP session, or a retry
-- after a rejection) createWriteProposal fell back to the existing row while
-- its caller auto-applied the NEW envelope anyway and then failed to find it.
--
-- Now both the lookup and the index use one key: (design_id,
-- idempotency_scope, action_id), where the scope is the MCP session
-- ("mcp:<clientKey>:<instanceId>") or, in-app, the chat ("chat:<chatId>").
-- A conflict on this index means "this exact action already exists" and the
-- caller returns that proposal without applying anything.
ALTER TABLE assistant_write_proposal ADD COLUMN idempotency_scope TEXT;
--> statement-breakpoint
UPDATE assistant_write_proposal
  SET idempotency_scope = 'chat:' || chat_id
  WHERE idempotency_scope IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_assistant_write_proposal_action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_write_proposal_action_scope
  ON assistant_write_proposal(design_id, idempotency_scope, action_id)
  WHERE action_id IS NOT NULL;
