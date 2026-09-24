CREATE TABLE `study_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`version` text NOT NULL,
	`assignments` text NOT NULL,
	`created_at` text NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_sessions_token_hash_unique` ON `study_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `study_votes` (
	`session_id` text NOT NULL,
	`trial_id` text NOT NULL,
	`dimension` text NOT NULL,
	`choice` text NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`elapsed_ms` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `trial_id`, `dimension`),
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_votes_dimension` ON `study_votes` (`dimension`);