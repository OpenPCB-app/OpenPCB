CREATE TABLE `library_footprint_models` (
	`footprint_id` text PRIMARY KEY NOT NULL REFERENCES `library_footprints`(`id`) ON DELETE CASCADE,
	`status` text NOT NULL,
	`glb_path` text,
	`glb_sha256` text,
	`source_step_path` text,
	`source_step_sha256` text,
	`source_filename` text,
	`source_byte_size` integer,
	`model_ref_json` text,
	`tessellation_params_json` text,
	`converter_version` text,
	`byte_size` integer,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
