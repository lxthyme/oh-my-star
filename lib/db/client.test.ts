import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import { repos, userRepos, repoUserData, tags, repoTags } from "./schema"

describe("createTestDb", () => {
  it("creates all five tables and allows inserting into each", async () => {
    const db = await createTestDb()

    await db
      .insert(repos)
      .values({
        id: 1,
        fullName: "octocat/Hello-World",
        name: "Hello-World",
        ownerLogin: "octocat",
        htmlUrl: "https://github.com/octocat/Hello-World",
      })
      .run()
    await db
      .insert(userRepos)
      .values({ userId: 100, repoId: 1, isOwned: 1 })
      .run()
    await db
      .insert(repoUserData)
      .values({ userId: 100, repoId: 1, isFavorite: 1 })
      .run()
    await db
      .insert(tags)
      .values({
        userId: 100,
        name: "favorite-tools",
        createdAt: "2026-01-01T00:00:00Z",
      })
      .run()
    const tag = (await db.select().from(tags).get())!
    await db
      .insert(repoTags)
      .values({ userId: 100, repoId: 1, tagId: tag.id })
      .run()

    expect(await db.select().from(repos).all()).toHaveLength(1)
    expect(await db.select().from(userRepos).all()).toHaveLength(1)
    expect(await db.select().from(repoUserData).all()).toHaveLength(1)
    expect(await db.select().from(repoTags).all()).toHaveLength(1)
  })

  it("returns independent state for separate in-memory instances", async () => {
    const dbA = await createTestDb()
    const dbB = await createTestDb()

    await dbA
      .insert(repos)
      .values({
        id: 1,
        fullName: "octocat/Hello-World",
        name: "Hello-World",
        ownerLogin: "octocat",
        htmlUrl: "https://github.com/octocat/Hello-World",
      })
      .run()

    expect(await dbA.select().from(repos).all()).toHaveLength(1)
    expect(await dbB.select().from(repos).all()).toHaveLength(0)
  })
})
