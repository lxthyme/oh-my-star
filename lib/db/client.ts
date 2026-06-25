import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import * as schema from "./schema"

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

export function createDb(url: string, authToken?: string): AppDatabase {
  const client = createClient({ url, authToken })
  return drizzle(client, { schema })
}

declare global {
  var __appDb: AppDatabase | undefined
}

const url = process.env.TURSO_DATABASE_URL ?? ":memory:"
const authToken = process.env.TURSO_AUTH_TOKEN

export const db = globalThis.__appDb ?? createDb(url, authToken)

if (process.env.NODE_ENV !== "production") {
  globalThis.__appDb = db
}
