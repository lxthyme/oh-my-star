import { describe, expect, it, beforeEach } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { repos, userRepos, repoUserData, tags, repoTags } from "./schema"
import {
  listRepos,
  listDistinctLanguages,
  setStarred,
  countReposBySource,
} from "./repos"

const TEST_USER_ID = 1001

interface RepoOverrides {
  id?: number
  name?: string
  fullName?: string
  language?: string | null
  fork?: number
  archived?: number
  isTemplate?: number
  mirrorUrl?: string | null
  isOwned?: number
  isStarred?: number
  starredAt?: string | null
  stargazersCount?: number
  pushedAt?: string | null
}

async function insertRepo(db: AppDatabase, overrides: RepoOverrides = {}) {
  const repo = {
    id: 1,
    name: "Hello-World",
    fullName: "octocat/Hello-World",
    language: "TypeScript" as string | null,
    fork: 0,
    archived: 0,
    isTemplate: 0,
    mirrorUrl: null as string | null,
    isOwned: 1,
    isStarred: 0,
    starredAt: null as string | null,
    stargazersCount: 0,
    pushedAt: "2026-01-01T00:00:00Z" as string | null,
    ...overrides,
  }

  await db
    .insert(repos)
    .values({
      id: repo.id,
      fullName: repo.fullName,
      name: repo.name,
      ownerLogin: "octocat",
      htmlUrl: `https://github.com/${repo.fullName}`,
      language: repo.language,
      fork: repo.fork,
      archived: repo.archived,
      isTemplate: repo.isTemplate,
      mirrorUrl: repo.mirrorUrl,
      stargazersCount: repo.stargazersCount,
      pushedAt: repo.pushedAt,
    })
    .run()

  await db
    .insert(userRepos)
    .values({
      userId: TEST_USER_ID,
      repoId: repo.id,
      isOwned: repo.isOwned,
      isStarred: repo.isStarred,
      starredAt: repo.starredAt,
    })
    .run()
}

describe("listRepos", () => {
  let db: AppDatabase

  beforeEach(async () => {
    db = await createTestDb()
  })

  it("filters by source (owned vs starred)", async () => {
    await insertRepo(db, { id: 1, isOwned: 1, isStarred: 0 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
      isOwned: 0,
      isStarred: 1,
    })

    const owned = await listRepos(db, TEST_USER_ID, { source: "owned" })
    const starred = await listRepos(db, TEST_USER_ID, { source: "starred" })
    expect(owned.items.map((r) => r.id)).toEqual([1])
    expect(starred.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by type=forks", async () => {
    await insertRepo(db, { id: 1, fork: 0 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
      fork: 1,
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      type: "forks",
    })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("excludes forks/archived/templates from type=sources", async () => {
    await insertRepo(db, { id: 1, fork: 0, archived: 0, isTemplate: 0 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Fork",
      name: "Fork",
      fork: 1,
    })
    await insertRepo(db, {
      id: 3,
      fullName: "octocat/Old",
      name: "Old",
      archived: 1,
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      type: "sources",
    })
    expect(result.items.map((r) => r.id)).toEqual([1])
  })

  it("filters by type=mirrors", async () => {
    await insertRepo(db, { id: 1 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Mirror",
      name: "Mirror",
      mirrorUrl: "https://git.example.com/x.git",
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      type: "mirrors",
    })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("ignores language filter when set to 'all'", async () => {
    await insertRepo(db, { id: 1, language: "TypeScript" })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Py",
      name: "Py",
      language: "Python",
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      language: "all",
    })
    expect(result.items).toHaveLength(2)
  })

  it("filters by a specific language", async () => {
    await insertRepo(db, { id: 1, language: "TypeScript" })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Py",
      name: "Py",
      language: "Python",
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      language: "Python",
    })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by favorite status using repo_user_data", async () => {
    await insertRepo(db, { id: 1 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
    })
    await db
      .insert(repoUserData)
      .values({ userId: TEST_USER_ID, repoId: 1, isFavorite: 1 })
      .run()

    const favorite = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      favorite: "favorite",
    })
    const notFavorite = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      favorite: "not_favorite",
    })
    expect(favorite.items.map((r) => r.id)).toEqual([1])
    expect(notFavorite.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by note status using repo_user_data", async () => {
    await insertRepo(db, { id: 1 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
    })
    await db
      .insert(repoUserData)
      .values({ userId: TEST_USER_ID, repoId: 1, note: "记得看看" })
      .run()

    const noted = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      note: "noted",
    })
    const notNoted = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      note: "not_noted",
    })
    expect(noted.items.map((r) => r.id)).toEqual([1])
    expect(notNoted.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by tagId and by 'untagged'", async () => {
    await insertRepo(db, { id: 1 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
    })
    const [tag] = await db
      .insert(tags)
      .values({
        userId: TEST_USER_ID,
        name: "cli",
        createdAt: "2026-01-01T00:00:00Z",
      })
      .returning({ id: tags.id })
    await db
      .insert(repoTags)
      .values({ userId: TEST_USER_ID, repoId: 1, tagId: tag.id })
      .run()

    const tagged = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      tagId: tag.id,
    })
    const untagged = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      tagId: "untagged",
    })
    expect(tagged.items.map((r) => r.id)).toEqual([1])
    expect(untagged.items.map((r) => r.id)).toEqual([2])
  })

  it("attaches resolved tags to each item", async () => {
    await insertRepo(db, { id: 1 })
    const [tag] = await db
      .insert(tags)
      .values({
        userId: TEST_USER_ID,
        name: "cli",
        createdAt: "2026-01-01T00:00:00Z",
      })
      .returning({ id: tags.id })
    await db
      .insert(repoTags)
      .values({ userId: TEST_USER_ID, repoId: 1, tagId: tag.id })
      .run()

    const result = await listRepos(db, TEST_USER_ID, { source: "owned" })
    expect(result.items[0].tags).toEqual([{ id: tag.id, name: "cli" }])
  })

  it("sorts by name ascending and by stars descending", async () => {
    await insertRepo(db, {
      id: 1,
      name: "Zeta",
      fullName: "octocat/Zeta",
      stargazersCount: 1,
    })
    await insertRepo(db, {
      id: 2,
      name: "Alpha",
      fullName: "octocat/Alpha",
      stargazersCount: 9,
    })

    const byName = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      sort: "name",
    })
    const byStars = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      sort: "stars",
    })
    expect(byName.items.map((r) => r.name)).toEqual(["Alpha", "Zeta"])
    expect(byStars.items.map((r) => r.id)).toEqual([2, 1])
  })

  it("paginates with the given page size", async () => {
    for (let i = 1; i <= 5; i++) {
      await insertRepo(db, {
        id: i,
        name: `Repo${i}`,
        fullName: `octocat/Repo${i}`,
      })
    }

    const page1 = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      perPage: 2,
      page: 1,
    })
    const page2 = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      perPage: 2,
      page: 2,
    })

    expect(page1.items).toHaveLength(2)
    expect(page2.items).toHaveLength(2)
    expect(page1.total).toBe(5)
  })

  it("only returns repos belonging to the given user", async () => {
    await insertRepo(db, { id: 1 })
    const otherUserId = 2002
    await db
      .insert(userRepos)
      .values({ userId: otherUserId, repoId: 1, isOwned: 1 })
      .run()

    const result = await listRepos(db, otherUserId, { source: "owned" })
    expect(result.items.map((r) => r.id)).toEqual([1])

    const stranger = await listRepos(db, 9999, { source: "owned" })
    expect(stranger.items).toEqual([])
  })
})

describe("listDistinctLanguages", () => {
  it("returns sorted unique languages for the given source", async () => {
    const db = await createTestDb()
    await insertRepo(db, {
      id: 1,
      fullName: "octocat/A",
      name: "A",
      language: "TypeScript",
    })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/B",
      name: "B",
      language: "Python",
    })
    await insertRepo(db, {
      id: 3,
      fullName: "octocat/C",
      name: "C",
      language: "TypeScript",
    })
    await insertRepo(db, {
      id: 4,
      fullName: "octocat/D",
      name: "D",
      language: "Go",
      isOwned: 0,
      isStarred: 1,
    })

    expect(await listDistinctLanguages(db, TEST_USER_ID, "owned")).toEqual([
      "Python",
      "TypeScript",
    ])
  })
})

describe("countReposBySource", () => {
  it("counts owned and starred repos independently of filters", async () => {
    const db = await createTestDb()
    await insertRepo(db, {
      id: 1,
      fullName: "octocat/A",
      name: "A",
      isOwned: 1,
      isStarred: 0,
    })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/B",
      name: "B",
      isOwned: 1,
      isStarred: 1,
    })
    await insertRepo(db, {
      id: 3,
      fullName: "octocat/C",
      name: "C",
      isOwned: 0,
      isStarred: 1,
    })

    expect(await countReposBySource(db, TEST_USER_ID)).toEqual({
      owned: 2,
      starred: 2,
    })
  })
})

describe("setStarred", () => {
  it("updates is_starred and starred_at", async () => {
    const db = await createTestDb()
    await insertRepo(db, { id: 1, fullName: "octocat/A", name: "A", isOwned: 1 })

    await setStarred(db, TEST_USER_ID, 1, true)
    let result = await listRepos(db, TEST_USER_ID, { source: "owned" })
    expect(result.items[0].isStarred).toBe(true)

    await setStarred(db, TEST_USER_ID, 1, false)
    result = await listRepos(db, TEST_USER_ID, { source: "owned" })
    expect(result.items[0].isStarred).toBe(false)
  })
})
