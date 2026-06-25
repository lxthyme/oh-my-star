import { describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb } from "./test-helpers"
import { repos, userRepos, repoUserData } from "./schema"
import { syncRepos, getLastSyncedAt } from "./sync"
import type { GitHubRepoData } from "../github"

const TEST_USER_ID = 1001

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
  it("marks owned repos with is_owned = 1 and is_starred = 0", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, { owned: [makeRepo()], starred: [] })

    const row = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    expect(row!.isOwned).toBe(1)
    expect(row!.isStarred).toBe(0)
  })

  it("marks a repo as both owned and starred when it appears in both lists", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, {
      owned: [makeRepo()],
      starred: [{ repo: makeRepo(), starredAt: "2026-01-01T00:00:00Z" }],
    })

    const row = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    expect(row!.isOwned).toBe(1)
    expect(row!.isStarred).toBe(1)
    expect(row!.starredAt).toBe("2026-01-01T00:00:00Z")
  })

  it("resets is_owned/is_starred for repos missing from a later sync, without touching repo_user_data", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, {
      owned: [makeRepo({ id: 1 })],
      starred: [],
    })
    await db
      .insert(repoUserData)
      .values({ userId: TEST_USER_ID, repoId: 1, isFavorite: 1, note: "记得看看" })
      .run()

    await syncRepos(db, TEST_USER_ID, { owned: [], starred: [] })

    const row = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    expect(row!.isOwned).toBe(0)
    expect(row!.isStarred).toBe(0)

    const userData = await db
      .select()
      .from(repoUserData)
      .where(
        and(eq(repoUserData.userId, TEST_USER_ID), eq(repoUserData.repoId, 1)),
      )
      .get()
    expect(userData!.isFavorite).toBe(1)
    expect(userData!.note).toBe("记得看看")
  })

  it("re-flags a repo back to 1 if it reappears in a subsequent sync", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, {
      owned: [],
      starred: [
        { repo: makeRepo({ id: 1 }), starredAt: "2026-01-01T00:00:00Z" },
      ],
    })
    await syncRepos(db, TEST_USER_ID, { owned: [], starred: [] })
    await syncRepos(db, TEST_USER_ID, {
      owned: [],
      starred: [
        { repo: makeRepo({ id: 1 }), starredAt: "2026-02-01T00:00:00Z" },
      ],
    })

    const row = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    expect(row!.isStarred).toBe(1)
    expect(row!.starredAt).toBe("2026-02-01T00:00:00Z")
  })

  it("stores mirrorUrl from GitHubRepoData", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, {
      owned: [
        makeRepo({
          mirrorUrl: "https://git.example.com/octocat/Hello-World.git",
        }),
      ],
      starred: [],
    })

    const row = await db.select().from(repos).where(eq(repos.id, 1)).get()
    expect(row!.mirrorUrl).toBe(
      "https://git.example.com/octocat/Hello-World.git",
    )
  })

  it("returns counts matching the input lists", async () => {
    const db = await createTestDb()
    const result = await syncRepos(db, TEST_USER_ID, {
      owned: [
        makeRepo({ id: 1 }),
        makeRepo({
          id: 2,
          fullName: "octocat/Spoon-Knife",
          name: "Spoon-Knife",
        }),
      ],
      starred: [
        {
          repo: makeRepo({ id: 3, fullName: "octocat/Other", name: "Other" }),
          starredAt: "2026-01-01T00:00:00Z",
        },
      ],
    })

    expect(result).toEqual({ ownedCount: 2, starredCount: 1 })
  })

  it("upserts shared repo metadata once even when synced by a different user", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, { owned: [makeRepo({ id: 1 })], starred: [] })
    await syncRepos(db, 2002, {
      owned: [],
      starred: [{ repo: makeRepo({ id: 1 }), starredAt: "2026-03-01T00:00:00Z" }],
    })

    expect(await db.select().from(repos).all()).toHaveLength(1)
    const mine = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    const theirs = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, 2002), eq(userRepos.repoId, 1)))
      .get()
    expect(mine!.isOwned).toBe(1)
    expect(theirs!.isStarred).toBe(1)
  })
})

describe("getLastSyncedAt", () => {
  it("returns null when there are no repos", async () => {
    const db = await createTestDb()
    expect(await getLastSyncedAt(db, TEST_USER_ID)).toBeNull()
  })

  it("returns the most recent synced_at across all repos for that user", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, { owned: [makeRepo({ id: 1 })], starred: [] })
    await db
      .update(userRepos)
      .set({ syncedAt: "2026-01-01T00:00:00.000Z" })
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .run()

    await syncRepos(db, TEST_USER_ID, {
      owned: [
        makeRepo({
          id: 2,
          fullName: "octocat/Spoon-Knife",
          name: "Spoon-Knife",
        }),
      ],
      starred: [],
    })
    await db
      .update(userRepos)
      .set({ syncedAt: "2026-03-01T00:00:00.000Z" })
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 2)))
      .run()

    expect(await getLastSyncedAt(db, TEST_USER_ID)).toBe(
      "2026-03-01T00:00:00.000Z",
    )
  })

  it("only considers the given user's synced_at, not other users'", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, { owned: [makeRepo({ id: 1 })], starred: [] })
    await db
      .update(userRepos)
      .set({ syncedAt: "2026-01-01T00:00:00.000Z" })
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .run()

    await syncRepos(db, 2002, { owned: [makeRepo({ id: 1 })], starred: [] })
    await db
      .update(userRepos)
      .set({ syncedAt: "2026-05-01T00:00:00.000Z" })
      .where(and(eq(userRepos.userId, 2002), eq(userRepos.repoId, 1)))
      .run()

    expect(await getLastSyncedAt(db, TEST_USER_ID)).toBe(
      "2026-01-01T00:00:00.000Z",
    )
  })
})
