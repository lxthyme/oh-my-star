import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  unique,
} from "drizzle-orm/sqlite-core"

export const repos = sqliteTable("repos", {
  id: integer("id").primaryKey(),
  fullName: text("full_name").notNull(),
  name: text("name").notNull(),
  ownerLogin: text("owner_login").notNull(),
  ownerAvatar: text("owner_avatar"),
  description: text("description"),
  htmlUrl: text("html_url").notNull(),
  language: text("language"),
  topics: text("topics").notNull().default("[]"),
  stargazersCount: integer("stargazers_count").notNull().default(0),
  forksCount: integer("forks_count").notNull().default(0),
  archived: integer("archived").notNull().default(0),
  fork: integer("fork").notNull().default(0),
  private: integer("private").notNull().default(0),
  isTemplate: integer("is_template").notNull().default(0),
  mirrorUrl: text("mirror_url"),
  pushedAt: text("pushed_at"),
  updatedAt: text("updated_at"),
  createdAt: text("created_at"),
})

export const userRepos = sqliteTable(
  "user_repos",
  {
    userId: integer("user_id").notNull(),
    repoId: integer("repo_id").notNull(),
    isOwned: integer("is_owned").notNull().default(0),
    isStarred: integer("is_starred").notNull().default(0),
    starredAt: text("starred_at"),
    syncedAt: text("synced_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repoId] })],
)

export const repoUserData = sqliteTable(
  "repo_user_data",
  {
    userId: integer("user_id").notNull(),
    repoId: integer("repo_id").notNull(),
    isFavorite: integer("is_favorite").notNull().default(0),
    note: text("note"),
    noteUpdatedAt: text("note_updated_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repoId] })],
)

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [unique().on(table.userId, table.name)],
)

export const repoTags = sqliteTable(
  "repo_tags",
  {
    userId: integer("user_id").notNull(),
    repoId: integer("repo_id").notNull(),
    tagId: integer("tag_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.repoId, table.tagId] }),
  ],
)
