-- H19 / OPENPCB-67 §3.5 — the DRC provenance stamp.
--
-- One nullable JSON column, written atomically with the counts it describes:
-- {v:1, ranAt, ranAtRevision, contentDigest, optionsDigest, engineVersion,
--  rawFootprintDigest}. The stamp repeats the row's own ran_at / revision, so a
-- row last rewritten by a binary that does not stamp (its upsert leaves this
-- column alone) fails the self-check and reads as "no provenance" — never as a
-- pass. Legacy rows stay NULL. Additive: older binaries select explicit columns.
alter table designer_drc_results add column provenance_json text;
