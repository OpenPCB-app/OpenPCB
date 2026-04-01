-- Migration: Add Component Import Job table for Unified Component Import feature
-- Created: 2026-04-01

-- Create component_import_job table
CREATE TABLE component_import_job (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  file_id TEXT REFERENCES file(id) ON DELETE SET NULL,
  original_file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  extracted_files TEXT, -- JSON array of ExtractedFileInfo
  parsed_symbol TEXT, -- JSON ParsedSymbolData
  parsed_footprint TEXT, -- JSON ParsedFootprintData
  model_3d_file_id TEXT REFERENCES file(id) ON DELETE SET NULL,
  extracted_metadata TEXT, -- JSON ExtractedMetadata
  conflict_status TEXT, -- 'none', 'name_exists', 'mpn_exists', 'both_exist'
  conflicting_family_id TEXT REFERENCES component_family(id) ON DELETE SET NULL,
  user_resolution TEXT, -- 'pending', 'create_new', 'update_existing', 'skip'
  progress INTEGER NOT NULL DEFAULT 0,
  progress_stage TEXT,
  error_code TEXT,
  error_message TEXT,
  created_family_id TEXT REFERENCES component_family(id) ON DELETE SET NULL,
  warnings TEXT, -- JSON array of ImportWarning
  uploaded_at INTEGER,
  processing_started_at INTEGER,
  preview_ready_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Create indexes for efficient querying
CREATE INDEX idx_import_job_workspace ON component_import_job(workspace_id);
CREATE INDEX idx_import_job_status ON component_import_job(status);
CREATE INDEX idx_import_job_workspace_status ON component_import_job(workspace_id, status);
CREATE INDEX idx_import_job_conflicting_family ON component_import_job(conflicting_family_id);
