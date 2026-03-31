PRAGMA foreign_keys=OFF;
--> statement-breakpoint

CREATE TABLE `__new_design` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text,
  `name` text NOT NULL,
  `description` text,
  `sort_order` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

INSERT INTO `__new_design`(
  `id`,
  `workspace_id`,
  `project_id`,
  `name`,
  `description`,
  `sort_order`,
  `created_at`,
  `updated_at`,
  `deleted_at`
)
SELECT
  `id`,
  `workspace_id`,
  `project_id`,
  `name`,
  `description`,
  `sort_order`,
  `created_at`,
  `updated_at`,
  `deleted_at`
FROM `design`;
--> statement-breakpoint

DROP TABLE `design`;
--> statement-breakpoint
ALTER TABLE `__new_design` RENAME TO `design`;
--> statement-breakpoint

CREATE INDEX `idx_design_workspace` ON `design` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `idx_design_project` ON `design` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_design_sort` ON `design` (`project_id`,`sort_order`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
