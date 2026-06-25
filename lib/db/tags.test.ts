import { describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { createDb } from "./client"
import { listTags, createTag, getRepoTags, setRepoTags } from "./tags"

describe("createTag", () => {
  it("creates a new tag", () => {
    const db = createDb(":memory:")
    const tag = createTag(db, "cli-tools")
    expect(tag.name).toBe("cli-tools")
    expect(listTags(db)).toEqual([{ id: tag.id, name: "cli-tools" }])
  })

  it("is idempotent for an existing name", () => {
    const db = createDb(":memory:")
    const first = createTag(db, "cli-tools")
    const second = createTag(db, "cli-tools")
    expect(second.id).toBe(first.id)
    expect(listTags(db)).toHaveLength(1)
  })
})

describe("listTags", () => {
  it("returns tags sorted by name", () => {
    const db = createDb(":memory:")
    createTag(db, "zebra")
    createTag(db, "alpha")
    expect(listTags(db).map((t) => t.name)).toEqual(["alpha", "zebra"])
  })
})

describe("setRepoTags / getRepoTags", () => {
  it("attaches tags to a repo, creating new ones as needed", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, is_owned) VALUES (1, 'octocat/A', 'A', 'octocat', 'https://x', 1)`,
      ),
    )

    const result = setRepoTags(db, 1, ["cli", "favorite-tools"])
    expect(result.map((t) => t.name).sort()).toEqual(["cli", "favorite-tools"])
    expect(
      getRepoTags(db, 1)
        .map((t) => t.name)
        .sort(),
    ).toEqual(["cli", "favorite-tools"])
  })

  it("replaces the previous tag set rather than appending", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, is_owned) VALUES (1, 'octocat/A', 'A', 'octocat', 'https://x', 1)`,
      ),
    )

    setRepoTags(db, 1, ["cli", "old-tag"])
    setRepoTags(db, 1, ["cli", "new-tag"])

    expect(
      getRepoTags(db, 1)
        .map((t) => t.name)
        .sort(),
    ).toEqual(["cli", "new-tag"])
  })

  it("trims whitespace and drops empty/duplicate names", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, is_owned) VALUES (1, 'octocat/A', 'A', 'octocat', 'https://x', 1)`,
      ),
    )

    const result = setRepoTags(db, 1, [" cli ", "cli", "", "  "])
    expect(result.map((t) => t.name)).toEqual(["cli"])
  })
})
