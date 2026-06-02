-- 0008_component_sourcing.sql
-- Assembly sourcing on library components (manufacturer + MPN + LCSC + supplier).
-- Populated by import paths or the component editor; inherited onto a placement's
-- propertiesJson at place time so the BOM is sourced without a manual override.
-- Nullable: existing components keep NULL until sourced.

ALTER TABLE library_components ADD COLUMN manufacturer TEXT;
ALTER TABLE library_components ADD COLUMN manufacturer_part_number TEXT;
ALTER TABLE library_components ADD COLUMN lcsc_part_number TEXT;
ALTER TABLE library_components ADD COLUMN supplier TEXT;
