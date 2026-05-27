-- Generic assistant write proposal metadata. The original proposal_json column
-- remains the compatibility payload for placement proposals; these columns let
-- newer proposal kinds expose a common title/summary/operation/source surface.

ALTER TABLE assistant_write_proposal ADD COLUMN tool_name TEXT;
--> statement-breakpoint
ALTER TABLE assistant_write_proposal ADD COLUMN title TEXT;
--> statement-breakpoint
ALTER TABLE assistant_write_proposal ADD COLUMN summary TEXT;
--> statement-breakpoint
ALTER TABLE assistant_write_proposal ADD COLUMN risk_level TEXT;
--> statement-breakpoint
ALTER TABLE assistant_write_proposal ADD COLUMN operations_json TEXT;
--> statement-breakpoint
ALTER TABLE assistant_write_proposal ADD COLUMN sources_json TEXT;
--> statement-breakpoint
ALTER TABLE assistant_write_proposal ADD COLUMN warnings_json TEXT;
--> statement-breakpoint
ALTER TABLE assistant_write_proposal ADD COLUMN envelope_json TEXT;
