-- Historical no-op migration. Safe assistant write tools are no longer feature
-- gated; create_design is available directly, while place_components still
-- stages an approval proposal before mutating schematic data.

SELECT 1;
