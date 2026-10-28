DROP INDEX `tags_user_id_scope_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_scope_name_unique_top` ON `tags` (`user_id`,`scope`,`name`) WHERE "tags"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_scope_parent_name_unique` ON `tags` (`user_id`,`scope`,`parent_id`,`name`) WHERE "tags"."parent_id" is not null;