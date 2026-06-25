import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { repos } from "./schema"
import { listTags, createTag, getRepoTags, setRepoTags } from "./tags"

const TEST_USER_ID = 1001

describe("createTag", () => {
  it("creates a new tag", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli-tools")
    expect(tag.name).toBe("cli-tools")
    expect(await listTags(db, TEST_USER_ID)).toEqual([
      { id: tag.id, name: "cli-tools" },
    ])
  })

  it("is idempotent for an existing name", async () => {
    const db = await createTestDb()
    const first = await createTag(db, TEST_USER_ID, "cli-tools")
    const second = await createTag(db, TEST_USER_ID, "cli-tools")
    expect(second.id).toBe(first.id)
    expect(await listTags(db, TEST_USER_ID)).toHaveLength(1)
  })

  it("allows the same tag name for different users", async () => {
    const db = await createTestDb()
    const mine = await createTag(db, TEST_USER_ID, "cli-tools")
    const theirs = await createTag(db, 2002, "cli-tools")
    expect(theirs.id).not.toBe(mine.id)
  })
})

describe("listTags", () => {
  it("returns tags sorted by name", async () => {
    const db = await createTestDb()
    await createTag(db, TEST_USER_ID, "zebra")
    await createTag(db, TEST_USER_ID, "alpha")
    expect((await listTags(db, TEST_USER_ID)).map((t) => t.name)).toEqual([
      "alpha",
      "zebra",
    ])
  })
})

describe("setRepoTags / getRepoTags", () => {
  async function insertTestRepo(db: AppDatabase) {
    await db
      .insert(repos)
      .values({
        id: 1,
        fullName: "octocat/A",
        name: "A",
        ownerLogin: "octocat",
        htmlUrl: "https://github.com/octocat/A",
      })
      .run()
  }

  it("attaches tags to a repo, creating new ones as needed", async () => {
    const db = await createTestDb()
    await insertTestRepo(db)

    const result = await setRepoTags(db, TEST_USER_ID, 1, [
      "cli",
      "favorite-tools",
    ])
    expect(result.map((t) => t.name).sort()).toEqual([
      "cli",
      "favorite-tools",
    ])
    expect(
      (await getRepoTags(db, TEST_USER_ID, 1)).map((t) => t.name).sort(),
    ).toEqual(["cli", "favorite-tools"])
  })

  it("replaces the previous tag set rather than appending", async () => {
    const db = await createTestDb()
    await insertTestRepo(db)

    await setRepoTags(db, TEST_USER_ID, 1, ["cli", "old-tag"])
    await setRepoTags(db, TEST_USER_ID, 1, ["cli", "new-tag"])

    expect(
      (await getRepoTags(db, TEST_USER_ID, 1)).map((t) => t.name).sort(),
    ).toEqual(["cli", "new-tag"])
  })

  it("trims whitespace and drops empty/duplicate names", async () => {
    const db = await createTestDb()
    await insertTestRepo(db)

    const result = await setRepoTags(db, TEST_USER_ID, 1, [
      " cli ",
      "cli",
      "",
      "  ",
    ])
    expect(result.map((t) => t.name)).toEqual(["cli"])
  })
})
