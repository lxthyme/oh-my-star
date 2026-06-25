CREATE TABLE `repo_tags` (
	`user_id` integer NOT NULL,
	`repo_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `repo_id`, `tag_id`)
);
--> statement-breakpoint
CREATE TABLE `repo_user_data` (
	`user_id` integer NOT NULL,
	`repo_id` integer NOT NULL,
	`is_favorite` integer DEFAULT 0 NOT NULL,
	`note` text,
	`note_updated_at` text,
	PRIMARY KEY(`user_id`, `repo_id`)
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` integer PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`name` text NOT NULL,
	`owner_login` text NOT NULL,
	`owner_avatar` text,
	`description` text,
	`html_url` text NOT NULL,
	`language` text,
	`topics` text DEFAULT '[]' NOT NULL,
	`stargazers_count` integer DEFAULT 0 NOT NULL,
	`forks_count` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`fork` integer DEFAULT 0 NOT NULL,
	`private` integer DEFAULT 0 NOT NULL,
	`is_template` integer DEFAULT 0 NOT NULL,
	`mirror_url` text,
	`pushed_at` text,
	`updated_at` text,
	`created_at` text
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_id_name_unique` ON `tags` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `user_repos` (
	`user_id` integer NOT NULL,
	`repo_id` integer NOT NULL,
	`is_owned` integer DEFAULT 0 NOT NULL,
	`is_starred` integer DEFAULT 0 NOT NULL,
	`starred_at` text,
	`synced_at` text,
	PRIMARY KEY(`user_id`, `repo_id`)
);
