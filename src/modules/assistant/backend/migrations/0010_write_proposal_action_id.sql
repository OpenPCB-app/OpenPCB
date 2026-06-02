-- F6: promote the model-supplied idempotency key (`action_id`, previously only
-- inside envelope_json) to a first-class column with a UNIQUE index. The
-- in-memory dedup (findPriorByActionId) handles the sequential case; this index
-- is the race backstop — two CONCURRENT submits with the same
-- (design_id, action_id) can no longer create two proposals, so the duplicate
-- write is rejected at the DB. Combined with applyAssistantWriteProposal's
-- applied/partial short-circuit, the single proposal can only apply once.
-- Index enforcement does NOT depend on the foreign_keys pragma.
ALTER TABLE assistant_write_proposal ADD COLUMN action_id TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_write_proposal_action
  ON assistant_write_proposal(design_id, action_id)
  WHERE action_id IS NOT NULL;
