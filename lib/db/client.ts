import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import fs from "node:fs"
import path from "node:path"
import * as schema from "./schema"

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  owner_avatar TEXT,
  description TEXT,
  html_url TEXT NOT NULL,
  language TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  stargazers_count INTEGER NOT NULL DEFAULT 0,
  forks_count INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  fork INTEGER NOT NULL DEFAULT 0,
  private INTEGER NOT NULL DEFAULT 0,
  is_template INTEGER NOT NULL DEFAULT 0,
  mirror_url TEXT,
  pushed_at TEXT,
  updated_at TEXT,
  created_at TEXT,
  is_owned INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  starred_at TEXT,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS repo_user_data (
  repo_id INTEGER PRIMARY KEY REFERENCES repos(id),
  is_favorite INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  note_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_tags (
  repo_id INTEGER NOT NULL REFERENCES repos(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (repo_id, tag_id)
);
`

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

// CREATE TABLE IF NOT EXISTS 不会给已存在的旧表补列，新列需要单独迁移。
function migrate(sqlite: Database.Database): void {
  const columns = sqlite.prepare("PRAGMA table_info(repos)").all() as {
    name: string
  }[]
  if (!columns.some((column) => column.name === "mirror_url")) {
    sqlite.exec("ALTER TABLE repos ADD COLUMN mirror_url TEXT")
  }
}

export function createDb(dbPath: string): AppDatabase {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.exec(SCHEMA_SQL)
  migrate(sqlite)
  return drizzle(sqlite, { schema })
}

declare global {
  var __appDb: AppDatabase | undefined
}

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db")

export const db = globalThis.__appDb ?? createDb(dbPath)

if (process.env.NODE_ENV !== "production") {
  globalThis.__appDb = db
}
