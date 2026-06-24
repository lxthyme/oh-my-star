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
