-- 0005_pcb_traces.sql
-- Marker migration: declares the addition of `trace` and `via` rows to
-- `designer_pcb_entities`. The table is JSON-payload-based so no schema
-- change is required; this file exists so the migrator records that
-- traces+vias became part of the data model at this revision.
SELECT 1;
