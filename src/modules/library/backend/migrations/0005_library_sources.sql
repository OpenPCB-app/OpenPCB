-- 0005_library_sources.sql
-- Introduces the syncable-library model: installed library namespaces
-- (library_sources) + installed package versions per namespace
-- (library_releases). Existing flat tables gain source_id / version / uuid /
-- content_sha256 columns so each row can be traced back to a release.

CREATE TABLE IF NOT EXISTS library_sources (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  license       TEXT,
  homepage      TEXT,
  is_read_only  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_releases (
  source_id        TEXT NOT NULL REFERENCES library_sources(id),
  version          TEXT NOT NULL,
  channel          TEXT NOT NULL,
  install_origin   TEXT NOT NULL,
  package_sha256   TEXT NOT NULL,
  signature_valid  INTEGER NOT NULL DEFAULT 0,
  installed_at     TEXT NOT NULL,
  manifest_json    TEXT NOT NULL,
  PRIMARY KEY (source_id, version)
);

CREATE INDEX IF NOT EXISTS library_releases_source_idx
  ON library_releases(source_id);

ALTER TABLE library_symbols    ADD COLUMN source_id TEXT;
ALTER TABLE library_symbols    ADD COLUMN version   TEXT;
ALTER TABLE library_symbols    ADD COLUMN uuid      TEXT;
ALTER TABLE library_symbols    ADD COLUMN content_sha256 TEXT;

ALTER TABLE library_footprints ADD COLUMN source_id TEXT;
ALTER TABLE library_footprints ADD COLUMN version   TEXT;
ALTER TABLE library_footprints ADD COLUMN uuid      TEXT;
ALTER TABLE library_footprints ADD COLUMN content_sha256 TEXT;

ALTER TABLE library_components ADD COLUMN source_id TEXT;
ALTER TABLE library_components ADD COLUMN version   TEXT;
ALTER TABLE library_components ADD COLUMN uuid      TEXT;
ALTER TABLE library_components ADD COLUMN content_sha256 TEXT;
ALTER TABLE library_components ADD COLUMN origin_json TEXT;

CREATE INDEX IF NOT EXISTS library_symbols_source_idx
  ON library_symbols(source_id);
CREATE INDEX IF NOT EXISTS library_footprints_source_idx
  ON library_footprints(source_id);
CREATE INDEX IF NOT EXISTS library_components_source_idx
  ON library_components(source_id);
