import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { gists, gistUserData, userGists } from "./schema"
import {
  countGistsBySource,
  listGists,
  parseGistFiles,
  setGistStarred,
} from "./gists"
import { setGistTags } from "./gist-tags"

const TEST_USER_ID = 1001

interface GistOverrides {
  id?: string
  description?: string | null
  public?: number
  files?: string
  createdAt?: string | null
  updatedAt?: string | null
  isOwned?: number
  isStarred?: number
  stargazersCount?: number
}

async function insertGist(db: AppDatabase, overrides: GistOverrides = {}) {
  const gist = {
    id: "abc123",
    description: "A demo gist" as string | null,
    public: 1,
    files: JSON.stringify([
      { name: "hello.ts", language: "TypeScript", size: 20, preview: "const x = 1" },
    ]),
    createdAt: "2026-01-01T00:00:00Z" as string | null,
    updatedAt: "2026-01-02T00:00:00Z" as string | null,
    isOwned: 1,
    isStarred: 0,
    stargazersCount: 0,
    ...overrides,
  }

  await db
    .insert(gists)
    .values({
      id: gist.id,
      description: gist.description,
      htmlUrl: `https://gist.github.com/${gist.id}`,
      ownerLogin: "octocat",
      public: gist.public,
      commentsCount: 0,
      forksCount: 0,
      stargazersCount: gist.stargazersCount,
      files: gist.files,
      createdAt: gist.createdAt,
      updatedAt: gist.updatedAt,
    })
    .run()

  await db
    .insert(userGists)
    .values({
      userId: TEST_USER_ID,
      gistId: gist.id,
      isOwned: gist.isOwned,
      isStarred: gist.isStarred,
    })
    .run()

  return gist.id
}

describe("parseGistFiles", () => {
  it("parses the files JSON and returns an empty array on bad input", () => {
    expect(parseGistFiles("[]")).toEqual([])
    expect(
      parseGistFiles(JSON.stringify([{ name: "a", language: null, size: 1, preview: "" }])),
    ).toEqual([{ name: "a", language: null, size: 1, preview: "" }])
    expect(parseGistFiles("not-json")).toEqual([])
    expect(parseGistFiles('{"nope":1}')).toEqual([])
  })
})

describe("listGists", () => {
  it("filters by source (owned vs starred)", async () => {
    const db = await createTestDb()
    await insertGist(db, { id: "o1", isOwned: 1, isStarred: 0 })
    await insertGist(db, { id: "s1", isOwned: 0, isStarred: 1 })

    const owned = await listGists(db, TEST_USER_ID, { source: "owned" })
    expect(owned.items.map((g) => g.id)).toEqual(["o1"])
    const starred = await listGists(db, TEST_USER_ID, { source: "starred" })
    expect(starred.items.map((g) => g.id)).toEqual(["s1"])
  })

  it("filters by visibility (public/secret)", async () => {
    const db = await createTestDb()
    await insertGist(db, { id: "pub", public: 1 })
    await insertGist(db, { id: "sec", public: 0 })

    const all = await listGists(db, TEST_USER_ID, { source: "owned" })
    expect(all.items.map((g) => g.id).sort()).toEqual(["pub", "sec"])

    const onlyPublic = await listGists(db, TEST_USER_ID, {
      source: "owned",
      type: "public",
    })
    expect(onlyPublic.items.map((g) => g.id)).toEqual(["pub"])

    const onlySecret = await listGists(db, TEST_USER_ID, {
      source: "owned",
      type: "secret",
    })
    expect(onlySecret.items.map((g) => g.id)).toEqual(["sec"])
  })

  it("searches description and file content", async () => {
    const db = await createTestDb()
    await insertGist(db, { id: "a", description: "我的 React 配置" })
    await insertGist(db, {
      id: "b",
      description: null,
      files: JSON.stringify([
        { name: "setup.sh", language: null, size: 1, preview: "npm install react" },
      ]),
    })
    await insertGist(db, { id: "c", description: "无关内容" })

    const byDesc = await listGists(db, TEST_USER_ID, {
      source: "owned",
      search: "React",
    })
    expect(byDesc.items.map((g) => g.id).sort()).toEqual(["a", "b"])
  })

  it("filters by favorite and note", async () => {
    const db = await createTestDb()
    await insertGist(db, { id: "fav" })
    await insertGist(db, { id: "plain" })
    await db
      .insert(gistUserData)
      .values({ userId: TEST_USER_ID, gistId: "fav", isFavorite: 1, note: "重点" })
      .run()
    await db
      .insert(gistUserData)
      .values({ userId: TEST_USER_ID, gistId: "plain", isFavorite: 0, note: "" })
      .run()

    const fav = await listGists(db, TEST_USER_ID, {
      source: "owned",
      favorite: "favorite",
    })
    expect(fav.items.map((g) => g.id)).toEqual(["fav"])

    const noted = await listGists(db, TEST_USER_ID, {
      source: "owned",
      note: "noted",
    })
    expect(noted.items.map((g) => g.id)).toEqual(["fav"])
  })

  it("filters by tag, including untagged", async () => {
    const db = await createTestDb()
    await insertGist(db, { id: "tagged" })
    await insertGist(db, { id: "untagged" })
    const [tag] = await setGistTags(db, TEST_USER_ID, "tagged", [], ["cli"])

    const byTag = await listGists(db, TEST_USER_ID, {
      source: "owned",
      tagId: tag.id,
    })
    expect(byTag.items.map((g) => g.id)).toEqual(["tagged"])

    const untagged = await listGists(db, TEST_USER_ID, {
      source: "owned",
      tagId: "untagged",
    })
    expect(untagged.items.map((g) => g.id)).toEqual(["untagged"])
  })

  it("sorts by created asc/desc and updated", async () => {
    const db = await createTestDb()
    await insertGist(db, {
      id: "old",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })
    await insertGist(db, {
      id: "new",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    })

    const recent = await listGists(db, TEST_USER_ID, {
      source: "owned",
      sort: "created",
    })
    expect(recent.items.map((g) => g.id)).toEqual(["new", "old"])

    const leastRecent = await listGists(db, TEST_USER_ID, {
      source: "owned",
      sort: "created_asc",
    })
    expect(leastRecent.items.map((g) => g.id)).toEqual(["old", "new"])

    const updated = await listGists(db, TEST_USER_ID, {
      source: "owned",
      sort: "updated",
    })
    expect(updated.items.map((g) => g.id)).toEqual(["old", "new"])
  })

  it("paginates with total", async () => {
    const db = await createTestDb()
    for (let i = 0; i < 5; i++) {
      await insertGist(db, { id: `g${i}` })
    }

    const page1 = await listGists(db, TEST_USER_ID, {
      source: "owned",
      page: 1,
      perPage: 2,
    })
    expect(page1.items).toHaveLength(2)
    expect(page1.total).toBe(5)
    expect(page1.page).toBe(1)

    const page2 = await listGists(db, TEST_USER_ID, {
      source: "owned",
      page: 2,
      perPage: 2,
    })
    expect(page2.items).toHaveLength(2)
    const ids = new Set([...page1.items, ...page2.items].map((g) => g.id))
    expect(ids.size).toBe(4)
  })
})

describe("countGistsBySource", () => {
  it("counts owned and starred gists separately", async () => {
    const db = await createTestDb()
    await insertGist(db, { id: "a", isOwned: 1, isStarred: 1 })
    await insertGist(db, { id: "b", isOwned: 1, isStarred: 0 })
    await insertGist(db, { id: "c", isOwned: 0, isStarred: 1 })

    expect(await countGistsBySource(db, TEST_USER_ID)).toEqual({
      owned: 2,
      starred: 2,
    })
  })
})

describe("setGistStarred", () => {
  it("toggles the star flag and records the time", async () => {
    const db = await createTestDb()
    await insertGist(db, { id: "a", isStarred: 0 })

    await setGistStarred(db, TEST_USER_ID, "a", true)
    const on = await listGists(db, TEST_USER_ID, { source: "starred" })
    expect(on.items.map((g) => g.id)).toEqual(["a"])

    await setGistStarred(db, TEST_USER_ID, "a", false)
    const off = await listGists(db, TEST_USER_ID, { source: "starred" })
    expect(off.items).toEqual([])
  })
})
