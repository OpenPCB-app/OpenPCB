ALTER TABLE `library_components` ADD COLUMN `is_builtin` INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX `library_components_is_builtin_idx` ON `library_components` (`is_builtin`);
