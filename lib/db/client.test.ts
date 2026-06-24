import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { createDb } from "./client"
import { repos, repoUserData, tags, repoTags } from "./schema"

describe("createDb", () => {
  it("creates all four tables and allows inserting into each", () => {
    const db = createDb(":memory:")

    db.insert(repos)
      .values({
        id: 1,
        fullName: "octocat/Hello-World",
        name: "Hello-World",
        ownerLogin: "octocat",
        htmlUrl: "https://github.com/octocat/Hello-World",
      })
      .run()
    db.insert(repoUserData).values({ repoId: 1, isFavorite: 1 }).run()
    db.insert(tags).values({ name: "favorite-tools", createdAt: "2026-01-01T00:00:00Z" }).run()
    const tag = db.select().from(tags).get()!
    db.insert(repoTags).values({ repoId: 1, tagId: tag.id }).run()

    expect(db.select().from(repos).all()).toHaveLength(1)
    expect(db.select().from(repoUserData).all()).toHaveLength(1)
    expect(db.select().from(repoTags).all()).toHaveLength(1)
  })

  it("returns independent state for separate :memory: instances", () => {
    const dbA = createDb(":memory:")
    const dbB = createDb(":memory:")

    db_insert_one(dbA)

    expect(dbA.select().from(repos).all()).toHaveLength(1)
    expect(dbB.select().from(repos).all()).toHaveLength(0)
  })

  it("backfills the mirror_url column for a pre-existing database that lacks it", () => {
    const dbPath = path.join(os.tmpdir(), `oh-my-star-test-${Date.now()}-${Math.random()}.db`)
    const legacy = new Database(dbPath)
    legacy.exec(`
      CREATE TABLE repos (
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
        pushed_at TEXT,
        updated_at TEXT,
        created_at TEXT,
        is_owned INTEGER NOT NULL DEFAULT 0,
        is_starred INTEGER NOT NULL DEFAULT 0,
        starred_at TEXT,
        synced_at TEXT
      )
    `)
    legacy.close()

    const db = createDb(dbPath)
    db.insert(repos)
      .values({
        id: 1,
        fullName: "octocat/Hello-World",
        name: "Hello-World",
        ownerLogin: "octocat",
        htmlUrl: "https://github.com/octocat/Hello-World",
        mirrorUrl: "https://git.example.com/octocat/Hello-World.git",
      })
      .run()

    expect(db.select().from(repos).get()!.mirrorUrl).toBe("https://git.example.com/octocat/Hello-World.git")

    fs.rmSync(dbPath, { force: true })
    fs.rmSync(`${dbPath}-shm`, { force: true })
    fs.rmSync(`${dbPath}-wal`, { force: true })
  })
})

function db_insert_one(db: ReturnType<typeof createDb>) {
  db.insert(repos)
    .values({
      id: 1,
      fullName: "octocat/Hello-World",
      name: "Hello-World",
      ownerLogin: "octocat",
      htmlUrl: "https://github.com/octocat/Hello-World",
    })
    .run()
}
