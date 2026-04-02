-- Migration: footprintOptions[] array
-- Migrate from single footprintPayload + defaultFootprintId to footprintOptions[] array

-- Step 1: Add new columns
ALTER TABLE `component_variants` ADD COLUMN `footprint_options` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `component_variants` ADD COLUMN `default_footprint_option_id` text;
--> statement-breakpoint

-- Step 2: Migrate existing data
-- For each variant with footprintPayload, create a single-item array
UPDATE `component_variants`
SET 
  `footprint_options` = json_array(
    json_object(
      'id', COALESCE(`default_footprint_id`, `id`),
      'variantId', `id`,
      'label', 'Default',
      'isDefault', json('true'),
      'kicadPayload', json(`footprint_payload`),
      'model3dOptions', json('[]'),
      'densityLevel', json('null'),
      'ipcName', json('null')
    )
  ),
  `default_footprint_option_id` = COALESCE(`default_footprint_id`, `id`)
WHERE `footprint_payload` IS NOT NULL;
--> statement-breakpoint

-- Step 3: Drop old columns (SQLite doesn't support DROP COLUMN in older versions,
-- but Drizzle handles this via table recreation. For direct SQL, we use a workaround)
-- Note: SQLite 3.35.0+ supports ALTER TABLE DROP COLUMN
-- For compatibility, we'll use the column renaming approach if needed

-- Create new table without old columns
CREATE TABLE `component_variants_new` (
  `id` text PRIMARY KEY NOT NULL,
  `component_id` text NOT NULL,
  `canonical_code` text NOT NULL,
  `human_label` text NOT NULL,
  `imperial_alias` text,
  `metric_alias` text,
  `mount_type` text NOT NULL,
  `dimensions` text,
  `is_default` integer DEFAULT false NOT NULL,
  `pin_remap_table` text,
  `footprint_options` text NOT NULL DEFAULT '[]',
  `default_footprint_option_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- Copy data to new table
INSERT INTO `component_variants_new` (
  `id`, `component_id`, `canonical_code`, `human_label`, `imperial_alias`,
  `metric_alias`, `mount_type`, `dimensions`, `is_default`, `pin_remap_table`,
  `footprint_options`, `default_footprint_option_id`, `created_at`, `updated_at`
)
SELECT 
  `id`, `component_id`, `canonical_code`, `human_label`, `imperial_alias`,
  `metric_alias`, `mount_type`, `dimensions`, `is_default`, `pin_remap_table`,
  `footprint_options`, `default_footprint_option_id`, `created_at`, `updated_at`
FROM `component_variants`;
--> statement-breakpoint

-- Drop old table
DROP TABLE `component_variants`;
--> statement-breakpoint

-- Rename new table
ALTER TABLE `component_variants_new` RENAME TO `component_variants`;
--> statement-breakpoint

-- Recreate indexes
CREATE INDEX IF NOT EXISTS `idx_component_variants_component` ON `component_variants` (`component_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_component_variants_default` ON `component_variants` (`component_id`,`is_default`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ux_component_variants_component_code` ON `component_variants` (`component_id`,`canonical_code`);
