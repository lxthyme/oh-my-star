import Database from "better-sqlite3"
import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import * as schema from "../lib/db/schema"

interface LegacyRepoRow {
  id: number
  full_name: string
  name: string
  owner_login: string
  owner_avatar: string | null
  description: string | null
  html_url: string
  language: string | null
  topics: string
  stargazers_count: number
  forks_count: number
  archived: number
  fork: number
  private: number
  is_template: number
  mirror_url: string | null
  pushed_at: string | null
  updated_at: string | null
  created_at: string | null
  is_owned: number
  is_starred: number
  starred_at: string | null
  synced_at: string | null
}

interface LegacyRepoUserDataRow {
  repo_id: number
  is_favorite: number
  note: string | null
  note_updated_at: string | null
}

interface LegacyTagRow {
  id: number
  name: string
  created_at: string
}

interface LegacyRepoTagRow {
  repo_id: number
  tag_id: number
}

async function main() {
  const legacyDbPath = process.argv[2]
  const userId = Number(process.env.MIGRATION_USER_ID)
  if (!legacyDbPath) {
    throw new Error(
      "用法: npm run db:migrate-legacy -- <本地 data/app.db 路径>",
    )
  }
  if (!Number.isInteger(userId)) {
    throw new Error("请设置环境变量 MIGRATION_USER_ID 为你的 GitHub 数字 id")
  }

  const legacy = new Database(legacyDbPath, { readonly: true })
  const repoRows = legacy
    .prepare("SELECT * FROM repos")
    .all() as LegacyRepoRow[]
  const userDataRows = legacy
    .prepare("SELECT * FROM repo_user_data")
    .all() as LegacyRepoUserDataRow[]
  const tagRows = legacy.prepare("SELECT * FROM tags").all() as LegacyTagRow[]
  const repoTagRows = legacy
    .prepare("SELECT * FROM repo_tags")
    .all() as LegacyRepoTagRow[]
  legacy.close()

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })
  const db = drizzle(client, { schema })

  for (const row of repoRows) {
    await db.insert(schema.repos).values({
      id: row.id,
      fullName: row.full_name,
      name: row.name,
      ownerLogin: row.owner_login,
      ownerAvatar: row.owner_avatar,
      description: row.description,
      htmlUrl: row.html_url,
      language: row.language,
      topics: row.topics,
      stargazersCount: row.stargazers_count,
      forksCount: row.forks_count,
      archived: row.archived,
      fork: row.fork,
      private: row.private,
      isTemplate: row.is_template,
      mirrorUrl: row.mirror_url,
      pushedAt: row.pushed_at,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    })

    await db.insert(schema.userRepos).values({
      userId,
      repoId: row.id,
      isOwned: row.is_owned,
      isStarred: row.is_starred,
      starredAt: row.starred_at,
      syncedAt: row.synced_at,
    })
  }

  for (const row of userDataRows) {
    await db.insert(schema.repoUserData).values({
      userId,
      repoId: row.repo_id,
      isFavorite: row.is_favorite,
      note: row.note,
      noteUpdatedAt: row.note_updated_at,
    })
  }

  const tagIdMap = new Map<number, number>()
  for (const row of tagRows) {
    const [inserted] = await db
      .insert(schema.tags)
      .values({ userId, name: row.name, createdAt: row.created_at })
      .returning({ id: schema.tags.id })
    tagIdMap.set(row.id, inserted.id)
  }

  for (const row of repoTagRows) {
    const newTagId = tagIdMap.get(row.tag_id)
    if (newTagId === undefined) continue
    await db.insert(schema.repoTags).values({
      userId,
      repoId: row.repo_id,
      tagId: newTagId,
    })
  }

  const counts = {
    repos: (await db.select().from(schema.repos)).length,
    repoUserData: (await db.select().from(schema.repoUserData)).length,
    tags: (await db.select().from(schema.tags)).length,
    repoTags: (await db.select().from(schema.repoTags)).length,
  }
  const expected = {
    repos: repoRows.length,
    repoUserData: userDataRows.length,
    tags: tagRows.length,
    repoTags: repoTagRows.length,
  }

  console.log("迁移完成，行数核对：", { expected, actual: counts })

  const mismatched = (Object.keys(expected) as Array<keyof typeof expected>)
    .filter((key) => expected[key] !== counts[key])
  if (mismatched.length > 0) {
    throw new Error(
      `迁移后行数不一致：${mismatched.map((key) => `${key} 期望 ${expected[key]} 实际 ${counts[key]}`).join("; ")}`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
