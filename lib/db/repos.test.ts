import { describe, expect, it, beforeEach } from "vitest"
import { sql } from "drizzle-orm"
import { createDb, type AppDatabase } from "./client"
import { repoUserData, repoTags, tags } from "./schema"
import { listRepos, listDistinctLanguages, setStarred } from "./repos"

describe("listRepos", () => {
  let db: AppDatabase

  beforeEach(() => {
    db = createDb(":memory:")
  })

  function insertRepo(
    overrides: Partial<{
      id: number
      name: string
      fullName: string
      language: string | null
      fork: number
      archived: number
      isTemplate: number
      mirrorUrl: string | null
      isOwned: number
      isStarred: number
      starredAt: string | null
      stargazersCount: number
      pushedAt: string | null
    }> = {},
  ) {
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
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, language, fork, archived, is_template, mirror_url, is_owned, is_starred, starred_at, stargazers_count, pushed_at)
         VALUES (${repo.id}, '${repo.fullName}', '${repo.name}', 'octocat', 'https://github.com/${repo.fullName}', ${repo.language ? `'${repo.language}'` : "NULL"}, ${repo.fork}, ${repo.archived}, ${repo.isTemplate}, ${repo.mirrorUrl ? `'${repo.mirrorUrl}'` : "NULL"}, ${repo.isOwned}, ${repo.isStarred}, ${repo.starredAt ? `'${repo.starredAt}'` : "NULL"}, ${repo.stargazersCount}, '${repo.pushedAt}')`,
      ),
    )
  }

  it("filters by source (owned vs starred)", () => {
    insertRepo({ id: 1, isOwned: 1, isStarred: 0 })
    insertRepo({
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
      isOwned: 0,
      isStarred: 1,
    })

    expect(listRepos(db, { source: "owned" }).items.map((r) => r.id)).toEqual([
      1,
    ])
    expect(listRepos(db, { source: "starred" }).items.map((r) => r.id)).toEqual(
      [2],
    )
  })

  it("filters by type=forks", () => {
    insertRepo({ id: 1, fork: 0 })
    insertRepo({
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
      fork: 1,
    })

    const result = listRepos(db, { source: "owned", type: "forks" })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("excludes forks/archived/templates from type=sources", () => {
    insertRepo({ id: 1, fork: 0, archived: 0, isTemplate: 0 })
    insertRepo({ id: 2, fullName: "octocat/Fork", name: "Fork", fork: 1 })
    insertRepo({ id: 3, fullName: "octocat/Old", name: "Old", archived: 1 })

    const result = listRepos(db, { source: "owned", type: "sources" })
    expect(result.items.map((r) => r.id)).toEqual([1])
  })

  it("filters by type=mirrors", () => {
    insertRepo({ id: 1 })
    insertRepo({
      id: 2,
      fullName: "octocat/Mirror",
      name: "Mirror",
      mirrorUrl: "https://git.example.com/x.git",
    })

    const result = listRepos(db, { source: "owned", type: "mirrors" })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("ignores language filter when set to 'all'", () => {
    insertRepo({ id: 1, language: "TypeScript" })
    insertRepo({
      id: 2,
      fullName: "octocat/Py",
      name: "Py",
      language: "Python",
    })

    const result = listRepos(db, { source: "owned", language: "all" })
    expect(result.items).toHaveLength(2)
  })

  it("filters by a specific language", () => {
    insertRepo({ id: 1, language: "TypeScript" })
    insertRepo({
      id: 2,
      fullName: "octocat/Py",
      name: "Py",
      language: "Python",
    })

    const result = listRepos(db, { source: "owned", language: "Python" })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by favorite status using repo_user_data", () => {
    insertRepo({ id: 1 })
    insertRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })
    db.insert(repoUserData).values({ repoId: 1, isFavorite: 1 }).run()

    expect(
      listRepos(db, { source: "owned", favorite: "favorite" }).items.map(
        (r) => r.id,
      ),
    ).toEqual([1])
    expect(
      listRepos(db, { source: "owned", favorite: "not_favorite" }).items.map(
        (r) => r.id,
      ),
    ).toEqual([2])
  })

  it("filters by note status using repo_user_data", () => {
    insertRepo({ id: 1 })
    insertRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })
    db.insert(repoUserData).values({ repoId: 1, note: "记得看看" }).run()

    expect(
      listRepos(db, { source: "owned", note: "noted" }).items.map((r) => r.id),
    ).toEqual([1])
    expect(
      listRepos(db, { source: "owned", note: "not_noted" }).items.map(
        (r) => r.id,
      ),
    ).toEqual([2])
  })

  it("filters by tagId and by 'untagged'", () => {
    insertRepo({ id: 1 })
    insertRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })
    db.insert(tags)
      .values({ id: 1, name: "cli", createdAt: "2026-01-01T00:00:00Z" })
      .run()
    db.insert(repoTags).values({ repoId: 1, tagId: 1 }).run()

    expect(
      listRepos(db, { source: "owned", tagId: 1 }).items.map((r) => r.id),
    ).toEqual([1])
    expect(
      listRepos(db, { source: "owned", tagId: "untagged" }).items.map(
        (r) => r.id,
      ),
    ).toEqual([2])
  })

  it("attaches resolved tags to each item", () => {
    insertRepo({ id: 1 })
    db.insert(tags)
      .values({ id: 1, name: "cli", createdAt: "2026-01-01T00:00:00Z" })
      .run()
    db.insert(repoTags).values({ repoId: 1, tagId: 1 }).run()

    const result = listRepos(db, { source: "owned" })
    expect(result.items[0].tags).toEqual([{ id: 1, name: "cli" }])
  })

  it("sorts by name ascending and by stars descending", () => {
    insertRepo({
      id: 1,
      name: "Zeta",
      fullName: "octocat/Zeta",
      stargazersCount: 1,
    })
    insertRepo({
      id: 2,
      name: "Alpha",
      fullName: "octocat/Alpha",
      stargazersCount: 9,
    })

    expect(
      listRepos(db, { source: "owned", sort: "name" }).items.map((r) => r.name),
    ).toEqual(["Alpha", "Zeta"])
    expect(
      listRepos(db, { source: "owned", sort: "stars" }).items.map((r) => r.id),
    ).toEqual([2, 1])
  })

  it("paginates with the given page size", () => {
    for (let i = 1; i <= 5; i++) {
      insertRepo({ id: i, name: `Repo${i}`, fullName: `octocat/Repo${i}` })
    }

    const page1 = listRepos(db, { source: "owned", perPage: 2, page: 1 })
    const page2 = listRepos(db, { source: "owned", perPage: 2, page: 2 })

    expect(page1.items).toHaveLength(2)
    expect(page2.items).toHaveLength(2)
    expect(page1.total).toBe(5)
  })
})

describe("listDistinctLanguages", () => {
  it("returns sorted unique languages for the given source", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, language, is_owned) VALUES
         (1, 'octocat/A', 'A', 'octocat', 'https://x', 'TypeScript', 1),
         (2, 'octocat/B', 'B', 'octocat', 'https://x', 'Python', 1),
         (3, 'octocat/C', 'C', 'octocat', 'https://x', 'TypeScript', 1),
         (4, 'octocat/D', 'D', 'octocat', 'https://x', 'Go', 0)`,
      ),
    )

    expect(listDistinctLanguages(db, "owned")).toEqual(["Python", "TypeScript"])
  })
})

describe("setStarred", () => {
  it("updates is_starred and starred_at", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, is_owned) VALUES (1, 'octocat/A', 'A', 'octocat', 'https://x', 1)`,
      ),
    )

    setStarred(db, 1, true)
    expect(listRepos(db, { source: "owned" }).items[0].isStarred).toBe(true)

    setStarred(db, 1, false)
    expect(listRepos(db, { source: "owned" }).items[0].isStarred).toBe(false)
  })
})
