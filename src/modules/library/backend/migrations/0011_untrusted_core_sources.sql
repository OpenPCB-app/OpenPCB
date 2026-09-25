-- 0011_untrusted_core_sources.sql
-- Installed .opclib packs that omitted `library.kind` used to be stored as
-- kind 'core' + read-only, which made them unremovable. Only the bundled
-- OpenPCB core ('openpcb.core') is core; demote every other such row to 'team'.

UPDATE library_sources SET kind = 'team', is_read_only = 0
WHERE kind = 'core' AND id <> 'openpcb.core';
