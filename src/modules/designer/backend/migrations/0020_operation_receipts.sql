ALTER TABLE designer_command_log ADD COLUMN operation_identity_json TEXT;
--> statement-breakpoint
ALTER TABLE designer_command_log ADD COLUMN actor_scope TEXT;
--> statement-breakpoint
ALTER TABLE designer_command_log ADD COLUMN operation_id TEXT;
--> statement-breakpoint
CREATE INDEX designer_command_log_operation_idx ON designer_command_log (actor_scope, operation_id);
--> statement-breakpoint
CREATE TABLE designer_design_creation_receipts (
  action_id TEXT NOT NULL,
  actor_scope TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  identity_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  design_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_scope, action_id)
);
--> statement-breakpoint
CREATE INDEX designer_design_creation_receipts_operation_idx ON designer_design_creation_receipts (actor_scope, operation_id);
