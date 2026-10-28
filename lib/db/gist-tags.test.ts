import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { gists, userGists } from "./schema"
import { listTags } from "./tags"
import { getGistTags, setGistTags } from "./gist-tags"

const TEST_USER_ID = 1001

async function insertGist(db: AppDatabase, id: string, source: "owned" | "starred") {
  await db
    .insert(gists)
    .values({
      id,
      description: null,
      htmlUrl: `https://gist.github.com/${id}`,
      ownerLogin: "octocat",
      public: 1,
      commentsCount: 0,
      forksCount: 0,
      stargazersCount: 0,
      files: "[]",
    })
    .run()
  await db
    .insert(userGists)
    .values({
      userId: TEST_USER_ID,
      gistId: id,
      isOwned: source === "owned" ? 1 : 0,
      isStarred: source === "starred" ? 1 : 0,
    })
    .run()
}

describe("setGistTags / getGistTags", () => {
  it("creates gist-scoped tags and attaches them to a gist", async () => {
    const db = await createTestDb()
    await insertGist(db, "a", "owned")

    const result = await setGistTags(db, TEST_USER_ID, "a", [], ["cli", "snippet"])
    expect(result.map((t) => t.name).sort()).toEqual(["cli", "snippet"])
    expect((await getGistTags(db, TEST_USER_ID, "a")).map((t) => t.name).sort()).toEqual([
      "cli",
      "snippet",
    ])
  })

  it("keeps gist tags separate from repo tags even with the same name", async () => {
    const db = await createTestDb()
    await insertGist(db, "a", "owned")

    const [gistTag] = await setGistTags(db, TEST_USER_ID, "a", [], ["共享名字"])
    const repoTags = await listTags(db, TEST_USER_ID)
    expect(repoTags).toEqual([])
    const gistTagList = await listTags(db, TEST_USER_ID, undefined, "gist")
    expect(gistTagList.map((t) => t.id)).toEqual([gistTag.id])
  })

  it("counts gists per tag, scoped by source", async () => {
    const db = await createTestDb()
    await insertGist(db, "owned1", "owned")
    await insertGist(db, "owned2", "owned")
    await insertGist(db, "starred1", "starred")

    const [cli] = await setGistTags(db, TEST_USER_ID, "owned1", [], ["cli"])
    await setGistTags(db, TEST_USER_ID, "owned2", [], ["cli"])
    await setGistTags(db, TEST_USER_ID, "starred1", [], ["cli"])

    const countsAll = Object.fromEntries(
      (await listTags(db, TEST_USER_ID, undefined, "gist")).map((t) => [
        t.name,
        t.repoCount,
      ]),
    )
    expect(countsAll).toEqual({ cli: 3 })

    const countsOwned = Object.fromEntries(
      (await listTags(db, TEST_USER_ID, "owned", "gist")).map((t) => [
        t.name,
        t.repoCount,
      ]),
    )
    expect(countsOwned).toEqual({ cli: 2 })

    const countsStarred = Object.fromEntries(
      (await listTags(db, TEST_USER_ID, "starred", "gist")).map((t) => [
        t.name,
        t.repoCount,
      ]),
    )
    expect(countsStarred).toEqual({ cli: 1 })

    expect(cli.id).toBeTypeOf("number")
  })

  it("replaces the previous tag set rather than appending", async () => {
    const db = await createTestDb()
    await insertGist(db, "a", "owned")

    await setGistTags(db, TEST_USER_ID, "a", [], ["cli", "old"])
    await setGistTags(db, TEST_USER_ID, "a", [], ["cli", "new"])

    expect((await getGistTags(db, TEST_USER_ID, "a")).map((t) => t.name).sort()).toEqual([
      "cli",
      "new",
    ])
  })
})
