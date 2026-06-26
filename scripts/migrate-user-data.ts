/**
 * 一次性脚本：把旧 data/app.db 里的 tags / repo_user_data / repo_tags 迁移到 Turso。
 *
 * 前提：repos 和 user_repos 已通过 OAuth 同步写入 Turso（不再由本脚本处理）。
 *
 * 用法：
 *   MIGRATION_USER_ID=<GitHub 数字 id> npx tsx scripts/migrate-user-data.ts [旧库路径]
 *
 * 示例：
 *   MIGRATION_USER_ID=8361463 npx tsx scripts/migrate-user-data.ts data/app.db
 */

import Database from "better-sqlite3"
import { createClient } from "@libsql/client"
import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

const legacyPath = process.argv[2] ?? "data/app.db"
const userId = Number(process.env.MIGRATION_USER_ID)

if (!userId || !Number.isInteger(userId)) {
  console.error("请设置 MIGRATION_USER_ID 环境变量（GitHub 数字 id）")
  process.exit(1)
}

interface LegacyTag {
  id: number
  name: string
  created_at: string
}

interface LegacyRepoUserData {
  repo_id: number
  is_favorite: number
  note: string | null
  note_updated_at: string | null
}

interface LegacyRepoTag {
  repo_id: number
  tag_id: number
}

async function main() {
  const legacy = new Database(legacyPath, { readonly: true })
  const tagRows = legacy.prepare("SELECT * FROM tags").all() as LegacyTag[]
  const userDataRows = legacy
    .prepare("SELECT * FROM repo_user_data WHERE is_favorite = 1 OR note IS NOT NULL")
    .all() as LegacyRepoUserData[]
  const repoTagRows = legacy
    .prepare("SELECT * FROM repo_tags")
    .all() as LegacyRepoTag[]
  legacy.close()

  console.log(
    `读取旧库：tags=${tagRows.length} repo_user_data=${userDataRows.length} repo_tags=${repoTagRows.length}`,
  )

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  // 1. 迁移 tags，记录旧 id → 新 id 映射
  console.log("迁移 tags...")
  const tagIdMap = new Map<number, number>()
  for (const row of tagRows) {
    const r = await client.execute({
      sql: "INSERT INTO tags (user_id, name, created_at) VALUES (?,?,?) RETURNING id",
      args: [userId, row.name, row.created_at],
    })
    tagIdMap.set(row.id, Number(r.rows[0].id))
  }

  // 2. 迁移 repo_user_data（只迁移有内容的行）
  console.log("迁移 repo_user_data...")
  for (const row of userDataRows) {
    await client.execute({
      sql: "INSERT OR IGNORE INTO repo_user_data (user_id, repo_id, is_favorite, note, note_updated_at) VALUES (?,?,?,?,?)",
      args: [userId, row.repo_id, row.is_favorite, row.note, row.note_updated_at],
    })
  }

  // 3. 迁移 repo_tags
  console.log("迁移 repo_tags...")
  let skipped = 0
  for (const row of repoTagRows) {
    const newTagId = tagIdMap.get(row.tag_id)
    if (!newTagId) {
      skipped++
      continue
    }
    await client.execute({
      sql: "INSERT OR IGNORE INTO repo_tags (user_id, repo_id, tag_id) VALUES (?,?,?)",
      args: [userId, row.repo_id, newTagId],
    })
  }
  if (skipped > 0) console.log(`repo_tags 跳过（tag_id 未匹配）：${skipped}`)

  // 核对行数
  const [t, rud, rt] = await Promise.all([
    client.execute("SELECT COUNT(*) as n FROM tags"),
    client.execute("SELECT COUNT(*) as n FROM repo_user_data"),
    client.execute("SELECT COUNT(*) as n FROM repo_tags"),
  ])
  console.log(
    `迁移完成 — tags: ${t.rows[0].n} | repo_user_data: ${rud.rows[0].n} | repo_tags: ${rt.rows[0].n}`,
  )
  console.log(`期望 — tags: ${tagRows.length} | repo_user_data: ${userDataRows.length} | repo_tags: ${repoTagRows.length - skipped}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
