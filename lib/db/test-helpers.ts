import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as schema from "./schema"
import type { AppDatabase } from "./client"

// @libsql/client 的本地 sqlite3 驱动在每次 client.transaction() 后会清空已缓存的连接，
// 下次访问时用同一个 url 重新打开——字面量 :memory: 重开等于一个全新的空库，会丢光数据；
// 换成临时文件路径，重开就是重新打开同一个文件，数据正常保留。
export async function createTestDb(): Promise<AppDatabase> {
  const dir = mkdtempSync(join(tmpdir(), "next-github-star-test-"))
  const client = createClient({ url: `file:${join(dir, "test.db")}` })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: "./drizzle" })
  return db
}
