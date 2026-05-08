ALTER TABLE designer_schematic_parts ADD COLUMN properties_json TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
UPDATE designer_schematic_parts SET properties_json = '{}';
