CREATE TABLE designer_net_identity_state (
  design_id TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  next_seq INTEGER NOT NULL,
  active_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE designer_net_identity_retired (
  design_id TEXT NOT NULL,
  net_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reason TEXT NOT NULL,
  successor_ids_json TEXT NOT NULL,
  display_name TEXT,
  retired_at_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (design_id, net_id)
);
--> statement-breakpoint
CREATE INDEX designer_net_identity_retired_seq_idx ON designer_net_identity_retired (design_id, seq);
--> statement-breakpoint
CREATE TABLE designer_net_identity_quarantine (
  design_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  legacy_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  suggested_net_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (design_id, ref_kind, ref_id, legacy_value)
);
--> statement-breakpoint
CREATE TABLE designer_net_identity_backups (
  design_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (design_id, schema_version)
);
