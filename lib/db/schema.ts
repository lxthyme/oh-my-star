import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

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
    description: text("description"),
    /**
     * 标签归属的实体类型：repo = 仓库标签，gist = Gist 标签。
     * 两个命名空间互不干扰，同名标签可以分别存在。
     */
    scope: text("scope", { enum: ["repo", "gist"] }).notNull().default("repo"),
    /** 父标签 id；NULL 表示顶级标签（1 级） */
    parentId: integer("parent_id").references((): AnySQLiteColumn => tags.id),
    /**
     * 标签用途标记，NULL 为普通标签。
     * 用它而不是名称来识别专用标签，改名后身份不会丢。
     */
    role: text("role", { enum: ["orphan"] }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
  },
  (table) => [
    // 标签名只在同一层级内唯一：顶级标签之间、同一父标签下的子标签之间不能重名，
    // 但不同层级之间允许同名。SQLite 的 UNIQUE 对 NULL 视为互不相同，
    // 因此用两个部分索引分别约束「顶级」和「同一父级」两个集合。
    uniqueIndex("tags_user_scope_name_unique_top")
      .on(table.userId, table.scope, table.name)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("tags_user_scope_parent_name_unique")
      .on(table.userId, table.scope, table.parentId, table.name)
      .where(sql`${table.parentId} is not null`),
  ],
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

export const gists = sqliteTable("gists", {
  /** GitHub gist id，是字符串而不是数字 */
  id: text("id").primaryKey(),
  description: text("description"),
  htmlUrl: text("html_url").notNull(),
  ownerLogin: text("owner_login").notNull(),
  ownerAvatar: text("owner_avatar"),
  /** 1 = public，0 = secret */
  public: integer("public").notNull().default(0),
  commentsCount: integer("comments_count").notNull().default(0),
  forksCount: integer("forks_count").notNull().default(0),
  stargazersCount: integer("stargazers_count").notNull().default(0),
  /** 文件列表 JSON：[{ name, language, size, preview }]，preview 为截断后的内容预览 */
  files: text("files").notNull().default("[]"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
})

export const userGists = sqliteTable(
  "user_gists",
  {
    userId: integer("user_id").notNull(),
    gistId: text("gist_id").notNull(),
    isOwned: integer("is_owned").notNull().default(0),
    isStarred: integer("is_starred").notNull().default(0),
    starredAt: text("starred_at"),
    syncedAt: text("synced_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.gistId] })],
)

export const gistUserData = sqliteTable(
  "gist_user_data",
  {
    userId: integer("user_id").notNull(),
    gistId: text("gist_id").notNull(),
    isFavorite: integer("is_favorite").notNull().default(0),
    note: text("note"),
    noteUpdatedAt: text("note_updated_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.gistId] })],
)

export const gistTags = sqliteTable(
  "gist_tags",
  {
    userId: integer("user_id").notNull(),
    gistId: text("gist_id").notNull(),
    tagId: integer("tag_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.gistId, table.tagId] }),
  ],
)
