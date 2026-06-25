import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"
import * as schema from "./schema"
import type { AppDatabase } from "./client"

export async function createTestDb(): Promise<AppDatabase> {
  const client = createClient({ url: ":memory:" })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: "./drizzle" })
  return db
}
