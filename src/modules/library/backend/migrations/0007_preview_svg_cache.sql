-- 0007_preview_svg_cache.sql
-- Cache rendered preview SVGs by symbol/footprint content_sha256 so the
-- library grid can serve thumbnails with one cheap key lookup.
--
-- The SVG is content-addressed: identical models share a single row
-- regardless of whether they came from a symbol or a footprint, so `kind`
-- is metadata only (handy for debugging / cache stats, not part of the PK).

CREATE TABLE IF NOT EXISTS library_preview_svgs (
  content_sha256  TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,           -- 'symbol' | 'footprint'
  svg             TEXT NOT NULL,
  generated_at    TEXT NOT NULL
);
