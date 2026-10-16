import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { repos, userRepos } from "./schema"
import { listTags, createTag, getRepoTags, setRepoTags } from "./tags"

const TEST_USER_ID = 1001

async function insertRepoWithSource(
  db: AppDatabase,
  id: number,
  source: { isOwned?: number; isStarred?: number },
) {
  await db
    .insert(repos)
    .values({
      id,
      fullName: `octocat/${id}`,
      name: `r${id}`,
      ownerLogin: "octocat",
      htmlUrl: `https://github.com/octocat/${id}`,
    })
    .run()
  await db
    .insert(userRepos)
    .values({
      userId: TEST_USER_ID,
      repoId: id,
      isOwned: source.isOwned ?? 0,
      isStarred: source.isStarred ?? 0,
    })
    .run()
}

describe("createTag", () => {
  it("creates a new tag", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli-tools")
    expect(tag.name).toBe("cli-tools")
    expect(await listTags(db, TEST_USER_ID)).toEqual([
      { id: tag.id, name: "cli-tools", repoCount: 0 },
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

  it("counts repos per tag, scoped by source", async () => {
    const db = await createTestDb()
    await insertRepoWithSource(db, 1, { isOwned: 1 })
    await insertRepoWithSource(db, 2, { isOwned: 1 })
    await insertRepoWithSource(db, 3, { isStarred: 1 })

    const cli = await createTag(db, TEST_USER_ID, "cli")
    const docs = await createTag(db, TEST_USER_ID, "docs")
    await setRepoTags(db, TEST_USER_ID, 1, ["cli"])
    await setRepoTags(db, TEST_USER_ID, 2, ["cli", "docs"])
    await setRepoTags(db, TEST_USER_ID, 3, ["cli"])

    const countsAll = Object.fromEntries(
      (await listTags(db, TEST_USER_ID)).map((t) => [t.name, t.repoCount]),
    )
    expect(countsAll).toEqual({ cli: 3, docs: 1 })

    const countsOwned = Object.fromEntries(
      (await listTags(db, TEST_USER_ID, "owned")).map((t) => [
        t.name,
        t.repoCount,
      ]),
    )
    expect(countsOwned).toEqual({ cli: 2, docs: 1 })

    const countsStarred = Object.fromEntries(
      (await listTags(db, TEST_USER_ID, "starred")).map((t) => [
        t.name,
        t.repoCount,
      ]),
    )
    expect(countsStarred).toEqual({ cli: 1, docs: 0 })

    // sanity: ids map to expected entries
    expect((await listTags(db, TEST_USER_ID, "owned")).map((t) => t.id)).toEqual(
      [cli.id, docs.id].sort((a, b) => a - b),
    )
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
