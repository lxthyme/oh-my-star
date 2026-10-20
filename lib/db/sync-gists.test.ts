import { describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb } from "./test-helpers"
import { gists, userGists } from "./schema"
import { getLastGistSyncedAt, syncGists } from "./sync"
import type { GitHubGistData } from "../github"

const TEST_USER_ID = 1001

function makeGist(overrides: Partial<GitHubGistData> = {}): GitHubGistData {
  return {
    id: "abc123",
    description: "demo",
    htmlUrl: "https://gist.github.com/abc123",
    ownerLogin: "octocat",
    ownerAvatar: null,
    public: true,
    commentsCount: 0,
    forksCount: 0,
    stargazersCount: 0,
    files: [{ name: "a.ts", language: "TypeScript", size: 10, preview: "const x = 1" }],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  }
}

describe("syncGists", () => {
  it("marks owned and starred gists correctly", async () => {
    const db = await createTestDb()
    await syncGists(db, TEST_USER_ID, {
      owned: [makeGist()],
      starred: [makeGist({ id: "s1" })],
    })

    const owned = await db
      .select()
      .from(userGists)
      .where(and(eq(userGists.userId, TEST_USER_ID), eq(userGists.gistId, "abc123")))
      .get()
    expect(owned!.isOwned).toBe(1)
    expect(owned!.isStarred).toBe(0)

    const starred = await db
      .select()
      .from(userGists)
      .where(and(eq(userGists.userId, TEST_USER_ID), eq(userGists.gistId, "s1")))
      .get()
    expect(starred!.isStarred).toBe(1)
  })

  it("stores file previews as JSON and resets flags on a later empty sync", async () => {
    const db = await createTestDb()
    await syncGists(db, TEST_USER_ID, { owned: [makeGist()], starred: [] })

    const row = await db.select().from(gists).where(eq(gists.id, "abc123")).get()
    expect(JSON.parse(row!.files)).toEqual([
      { name: "a.ts", language: "TypeScript", size: 10, preview: "const x = 1" },
    ])

    await syncGists(db, TEST_USER_ID, { owned: [], starred: [] })
    const after = await db
      .select()
      .from(userGists)
      .where(and(eq(userGists.userId, TEST_USER_ID), eq(userGists.gistId, "abc123")))
      .get()
    expect(after!.isOwned).toBe(0)
    expect(after!.isStarred).toBe(0)
  })

  it("returns counts matching the input lists", async () => {
    const db = await createTestDb()
    const result = await syncGists(db, TEST_USER_ID, {
      owned: [makeGist(), makeGist({ id: "x2" })],
      starred: [makeGist({ id: "x3" })],
    })
    expect(result).toEqual({ ownedCount: 2, starredCount: 1 })
  })
})

describe("getLastGistSyncedAt", () => {
  it("returns null when no gists have been synced", async () => {
    const db = await createTestDb()
    expect(await getLastGistSyncedAt(db, TEST_USER_ID)).toBeNull()
  })

  it("returns the latest synced_at for the user", async () => {
    const db = await createTestDb()
    await syncGists(db, TEST_USER_ID, { owned: [makeGist()], starred: [] })
    expect(await getLastGistSyncedAt(db, TEST_USER_ID)).not.toBeNull()
  })
})
