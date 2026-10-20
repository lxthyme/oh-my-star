CREATE TABLE `gist_tags` (
	`user_id` integer NOT NULL,
	`gist_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `gist_id`, `tag_id`)
);
--> statement-breakpoint
CREATE TABLE `gist_user_data` (
	`user_id` integer NOT NULL,
	`gist_id` text NOT NULL,
	`is_favorite` integer DEFAULT 0 NOT NULL,
	`note` text,
	`note_updated_at` text,
	PRIMARY KEY(`user_id`, `gist_id`)
);
--> statement-breakpoint
CREATE TABLE `gists` (
	`id` text PRIMARY KEY NOT NULL,
	`description` text,
	`html_url` text NOT NULL,
	`owner_login` text NOT NULL,
	`owner_avatar` text,
	`public` integer DEFAULT 0 NOT NULL,
	`comments_count` integer DEFAULT 0 NOT NULL,
	`forks_count` integer DEFAULT 0 NOT NULL,
	`stargazers_count` integer DEFAULT 0 NOT NULL,
	`files` text DEFAULT '[]' NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `user_gists` (
	`user_id` integer NOT NULL,
	`gist_id` text NOT NULL,
	`is_owned` integer DEFAULT 0 NOT NULL,
	`is_starred` integer DEFAULT 0 NOT NULL,
	`starred_at` text,
	`synced_at` text,
	PRIMARY KEY(`user_id`, `gist_id`)
);
--> statement-breakpoint
DROP INDEX `tags_user_id_name_unique`;--> statement-breakpoint
ALTER TABLE `tags` ADD `scope` text DEFAULT 'repo' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_id_scope_name_unique` ON `tags` (`user_id`,`scope`,`name`);