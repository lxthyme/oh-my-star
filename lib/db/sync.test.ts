import { describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { createDb } from "./client"
import { repos, repoUserData } from "./schema"
import { syncRepos, getLastSyncedAt } from "./sync"
import type { GitHubRepoData } from "../github"

function makeRepo(overrides: Partial<GitHubRepoData> = {}): GitHubRepoData {
  return {
    id: 1,
    fullName: "octocat/Hello-World",
    name: "Hello-World",
    ownerLogin: "octocat",
    ownerAvatar: null,
    description: null,
    htmlUrl: "https://github.com/octocat/Hello-World",
    language: "TypeScript",
    topics: [],
    stargazersCount: 0,
    forksCount: 0,
    archived: false,
    fork: false,
    private: false,
    isTemplate: false,
    mirrorUrl: null,
    pushedAt: null,
    updatedAt: null,
    createdAt: null,
    ...overrides,
  }
}

describe("syncRepos", () => {
  it("marks owned repos with is_owned = 1 and is_starred = 0", () => {
    const db = createDb(":memory:")
    syncRepos(db, { owned: [makeRepo()], starred: [] })

    const row = db.select().from(repos).where(eq(repos.id, 1)).get()!
    expect(row.isOwned).toBe(1)
    expect(row.isStarred).toBe(0)
  })

  it("marks a repo as both owned and starred when it appears in both lists", () => {
    const db = createDb(":memory:")
    syncRepos(db, {
      owned: [makeRepo()],
      starred: [{ repo: makeRepo(), starredAt: "2026-01-01T00:00:00Z" }],
    })

    const row = db.select().from(repos).where(eq(repos.id, 1)).get()!
    expect(row.isOwned).toBe(1)
    expect(row.isStarred).toBe(1)
    expect(row.starredAt).toBe("2026-01-01T00:00:00Z")
  })

  it("resets is_owned/is_starred for repos missing from a later sync, without touching repo_user_data", () => {
    const db = createDb(":memory:")
    syncRepos(db, { owned: [makeRepo({ id: 1 })], starred: [] })
    db.insert(repoUserData).values({ repoId: 1, isFavorite: 1, note: "记得看看" }).run()

    syncRepos(db, { owned: [], starred: [] })

    const row = db.select().from(repos).where(eq(repos.id, 1)).get()!
    expect(row.isOwned).toBe(0)
    expect(row.isStarred).toBe(0)

    const userData = db.select().from(repoUserData).where(eq(repoUserData.repoId, 1)).get()!
    expect(userData.isFavorite).toBe(1)
    expect(userData.note).toBe("记得看看")
  })

  it("re-flags a repo back to 1 if it reappears in a subsequent sync", () => {
    const db = createDb(":memory:")
    syncRepos(db, { owned: [], starred: [{ repo: makeRepo({ id: 1 }), starredAt: "2026-01-01T00:00:00Z" }] })
    syncRepos(db, { owned: [], starred: [] })
    syncRepos(db, { owned: [], starred: [{ repo: makeRepo({ id: 1 }), starredAt: "2026-02-01T00:00:00Z" }] })

    const row = db.select().from(repos).where(eq(repos.id, 1)).get()!
    expect(row.isStarred).toBe(1)
    expect(row.starredAt).toBe("2026-02-01T00:00:00Z")
  })

  it("stores mirrorUrl from GitHubRepoData", () => {
    const db = createDb(":memory:")
    syncRepos(db, { owned: [makeRepo({ mirrorUrl: "https://git.example.com/octocat/Hello-World.git" })], starred: [] })

    const row = db.select().from(repos).where(eq(repos.id, 1)).get()!
    expect(row.mirrorUrl).toBe("https://git.example.com/octocat/Hello-World.git")
  })

  it("returns counts matching the input lists", () => {
    const db = createDb(":memory:")
    const result = syncRepos(db, {
      owned: [makeRepo({ id: 1 }), makeRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })],
      starred: [{ repo: makeRepo({ id: 3, fullName: "octocat/Other", name: "Other" }), starredAt: "2026-01-01T00:00:00Z" }],
    })

    expect(result).toEqual({ ownedCount: 2, starredCount: 1 })
  })
})

describe("getLastSyncedAt", () => {
  it("returns null when there are no repos", () => {
    const db = createDb(":memory:")
    expect(getLastSyncedAt(db)).toBeNull()
  })

  it("returns the most recent synced_at across all repos", () => {
    const db = createDb(":memory:")
    syncRepos(db, { owned: [makeRepo({ id: 1 })], starred: [] })
    db.update(repos).set({ syncedAt: "2026-01-01T00:00:00.000Z" }).where(eq(repos.id, 1)).run()

    syncRepos(db, { owned: [makeRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })], starred: [] })
    db.update(repos).set({ syncedAt: "2026-03-01T00:00:00.000Z" }).where(eq(repos.id, 2)).run()

    expect(getLastSyncedAt(db)).toBe("2026-03-01T00:00:00.000Z")
  })
})
