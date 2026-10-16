import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { repos, userRepos } from "./schema"
import {
  TagHierarchyError,
  listTagSubtreeIds,
  listTags,
  createTag,
  findTagByName,
  updateTag,
  deleteTag,
  getRepoTags,
  setRepoTags,
} from "./tags"
import { ORPHAN_TAG_NAME } from "../tag-limits"

const TEST_USER_ID = 1001

/** 只保留与层级无关的字段，避免每个断言都写一遍层级信息 */
function brief(tags: Awaited<ReturnType<typeof listTags>>) {
  return tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    description: tag.description,
    repoCount: tag.repoCount,
  }))
}

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
    expect(brief(await listTags(db, TEST_USER_ID))).toEqual([
      { id: tag.id, name: "cli-tools", description: null, repoCount: 0 },
    ])
  })

  it("stores the description", async () => {
    const db = await createTestDb()
    await createTag(db, TEST_USER_ID, "cli-tools", "  命令行工具  ")
    expect(brief(await listTags(db, TEST_USER_ID))).toEqual([
      {
        id: expect.any(Number),
        name: "cli-tools",
        description: "命令行工具",
        repoCount: 0,
      },
    ])
  })

  it("treats a blank description as null", async () => {
    const db = await createTestDb()
    await createTag(db, TEST_USER_ID, "cli-tools", "   ")
    expect((await listTags(db, TEST_USER_ID))[0].description).toBeNull()
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
    expect(
      (await listTags(db, TEST_USER_ID, "owned")).map((t) => t.id),
    ).toEqual([cli.id, docs.id].sort((a, b) => a - b))
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
    expect(result.map((t) => t.name).sort()).toEqual(["cli", "favorite-tools"])
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

describe("findTagByName", () => {
  it("finds a tag owned by the user only", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli-tools")
    expect(await findTagByName(db, TEST_USER_ID, "cli-tools")).toEqual({
      id: tag.id,
      name: "cli-tools",
    })
    expect(await findTagByName(db, TEST_USER_ID, "missing")).toBeNull()
    expect(await findTagByName(db, 2002, "cli-tools")).toBeNull()
  })
})

describe("updateTag", () => {
  it("renames a tag", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli-tools")
    expect(
      await updateTag(db, TEST_USER_ID, tag.id, { name: " cli " }),
    ).toEqual({ id: tag.id, name: "cli" })
    expect(brief(await listTags(db, TEST_USER_ID))).toEqual([
      { id: tag.id, name: "cli", description: null, repoCount: 0 },
    ])
  })

  it("updates the description without touching the name", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli-tools")
    await updateTag(db, TEST_USER_ID, tag.id, { description: "命令行工具" })
    expect(brief(await listTags(db, TEST_USER_ID))[0]).toEqual({
      id: tag.id,
      name: "cli-tools",
      description: "命令行工具",
      repoCount: 0,
    })
  })

  it("clears the description when given a blank string", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli", "命令行工具")
    await updateTag(db, TEST_USER_ID, tag.id, { description: "  " })
    expect((await listTags(db, TEST_USER_ID))[0].description).toBeNull()
  })

  it("returns null for a tag that does not belong to the user", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli-tools")
    expect(
      await updateTag(db, TEST_USER_ID, tag.id + 999, { name: "x" }),
    ).toBeNull()
    expect(await updateTag(db, 2002, tag.id, { name: "x" })).toBeNull()
    expect((await listTags(db, TEST_USER_ID))[0].name).toBe("cli-tools")
  })
})

describe("deleteTag", () => {
  it("deletes the tag and detaches it from repos", async () => {
    const db = await createTestDb()
    await insertRepoWithSource(db, 1, { isOwned: 1 })
    const tag = await createTag(db, TEST_USER_ID, "cli")
    await setRepoTags(db, TEST_USER_ID, 1, ["cli"])

    expect(await deleteTag(db, TEST_USER_ID, tag.id)).toEqual({
      ok: true,
      movedChildren: 0,
    })
    expect(await listTags(db, TEST_USER_ID)).toEqual([])
    expect(await getRepoTags(db, TEST_USER_ID, 1)).toEqual([])
  })

  it("returns ok: false when the tag does not exist", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli")
    expect(await deleteTag(db, TEST_USER_ID, tag.id + 999)).toEqual({
      ok: false,
      movedChildren: 0,
    })
    expect(await deleteTag(db, 2002, tag.id)).toEqual({
      ok: false,
      movedChildren: 0,
    })
    expect(await listTags(db, TEST_USER_ID)).toHaveLength(1)
  })

  it("moves children to the orphan tag", async () => {
    const db = await createTestDb()
    const parent = await createTag(db, TEST_USER_ID, "语言")
    const child = await createTag(db, TEST_USER_ID, "Go", null, parent.id)

    const result = await deleteTag(db, TEST_USER_ID, parent.id)
    expect(result).toEqual({ ok: true, movedChildren: 1 })

    const orphan = await findTagByName(db, TEST_USER_ID, ORPHAN_TAG_NAME)
    expect(orphan).not.toBeNull()
    expect(
      (await listTags(db, TEST_USER_ID)).map((t) => t.name).sort(),
    ).toEqual(["Go", ORPHAN_TAG_NAME])
    const moved = (await listTags(db, TEST_USER_ID)).find(
      (t) => t.id === child.id,
    )
    expect(moved?.parentId).toBe(orphan!.id)
    expect(moved?.path).toBe(`${ORPHAN_TAG_NAME} / Go`)
  })

  it("refuses to delete the orphan tag", async () => {
    const db = await createTestDb()
    const parent = await createTag(db, TEST_USER_ID, "语言")
    const child = await createTag(db, TEST_USER_ID, "Go", null, parent.id)
    await deleteTag(db, TEST_USER_ID, parent.id)

    const orphan = (await findTagByName(db, TEST_USER_ID, ORPHAN_TAG_NAME))!
    await expect(deleteTag(db, TEST_USER_ID, orphan.id)).rejects.toThrow(
      TagHierarchyError,
    )

    // 数据完好：标签还在，子标签仍在它下面
    expect(
      await findTagByName(db, TEST_USER_ID, ORPHAN_TAG_NAME),
    ).not.toBeNull()
    const moved = (await listTags(db, TEST_USER_ID)).find(
      (t) => t.id === child.id,
    )
    expect(moved?.parentId).toBe(orphan.id)
  })

  it("exposes role for every tag", async () => {
    const db = await createTestDb()
    const parent = await createTag(db, TEST_USER_ID, "语言")
    const child = await createTag(db, TEST_USER_ID, "Go", null, parent.id)

    const byId = new Map((await listTags(db, TEST_USER_ID)).map((t) => [t.id, t]))
    expect(byId.get(parent.id)!.role).toBeNull()
    expect(byId.get(child.id)!.role).toBeNull()

    await deleteTag(db, TEST_USER_ID, parent.id)
    const orphan = (await findTagByName(db, TEST_USER_ID, ORPHAN_TAG_NAME))!
    const after = new Map(
      (await listTags(db, TEST_USER_ID)).map((t) => [t.id, t]),
    )
    expect(after.get(orphan.id)!.role).toBe("orphan")
  })

  it("keeps the orphan identity after it is renamed", async () => {
    const db = await createTestDb()
    const parent = await createTag(db, TEST_USER_ID, "语言")
    await createTag(db, TEST_USER_ID, "Go", null, parent.id)
    await deleteTag(db, TEST_USER_ID, parent.id)

    const orphan = (await findTagByName(db, TEST_USER_ID, ORPHAN_TAG_NAME))!
    await updateTag(db, TEST_USER_ID, orphan.id, { name: "待整理" })

    // 改名后仍然是同一枚专用标签：不能删、原来的 id 不变
    expect(
      (await listTags(db, TEST_USER_ID)).find((t) => t.id === orphan.id)?.name,
    ).toBe("待整理")
    await expect(deleteTag(db, TEST_USER_ID, orphan.id)).rejects.toThrow(
      TagHierarchyError,
    )
  })

  it("rejects changing the parent of the orphan tag", async () => {
    const db = await createTestDb()
    const parent = await createTag(db, TEST_USER_ID, "语言")
    await createTag(db, TEST_USER_ID, "Go", null, parent.id)
    await deleteTag(db, TEST_USER_ID, parent.id)

    const orphan = (await findTagByName(db, TEST_USER_ID, ORPHAN_TAG_NAME))!
    const tool = await createTag(db, TEST_USER_ID, "工具")
    await expect(
      updateTag(db, TEST_USER_ID, orphan.id, { parentId: tool.id }),
    ).rejects.toThrow(TagHierarchyError)
    await expect(
      updateTag(db, TEST_USER_ID, orphan.id, { parentId: null }),
    ).rejects.toThrow(TagHierarchyError)
  })

  it("does not self-reference when the orphan tag is a child of the deleted tag", async () => {
    const db = await createTestDb()
    const parent = await createTag(db, TEST_USER_ID, "语言")
    const orphan = await createTag(db, TEST_USER_ID, ORPHAN_TAG_NAME)
    await updateTag(db, TEST_USER_ID, orphan.id, { parentId: parent.id })

    const result = await deleteTag(db, TEST_USER_ID, parent.id)
    expect(result).toEqual({ ok: true, movedChildren: 1 })

    const row = (await listTags(db, TEST_USER_ID)).find(
      (t) => t.id === orphan.id,
    )!
    expect(row.parentId).toBeNull()
    expect(row.depth).toBe(1)
  })
})

describe("tag hierarchy", () => {
  it("creates top-level tags by default", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli")
    const [row] = await listTags(db, TEST_USER_ID)
    expect(row.id).toBe(tag.id)
    expect(row.parentId).toBeNull()
    expect(row.depth).toBe(1)
    expect(row.path).toBe("cli")
    expect(row.childrenCount).toBe(0)
  })

  it("computes depth, path and childrenCount", async () => {
    const db = await createTestDb()
    const lang = await createTag(db, TEST_USER_ID, "语言")
    const go = await createTag(db, TEST_USER_ID, "Go", null, lang.id)
    const web = await createTag(db, TEST_USER_ID, "Web", null, lang.id)
    await createTag(db, TEST_USER_ID, "Gin", null, go.id)

    const byId = new Map(
      (await listTags(db, TEST_USER_ID)).map((t) => [t.id, t]),
    )
    expect(byId.get(go.id)!.depth).toBe(2)
    expect(byId.get(go.id)!.path).toBe("语言 / Go")
    expect(byId.get(go.id)!.childrenCount).toBe(1)
    expect(byId.get(lang.id)!.childrenCount).toBe(2)
    expect(byId.get(web.id)!.childrenCount).toBe(0)
  })

  it("counts repos including descendants without double counting", async () => {
    const db = await createTestDb()
    await insertRepoWithSource(db, 1, { isOwned: 1 })
    await insertRepoWithSource(db, 2, { isOwned: 1 })

    const lang = await createTag(db, TEST_USER_ID, "语言")
    await createTag(db, TEST_USER_ID, "Go", null, lang.id)
    // repo 1 同时打了父与子，只能算一次
    await setRepoTags(db, TEST_USER_ID, 1, ["语言", "Go"])
    await setRepoTags(db, TEST_USER_ID, 2, ["Go"])

    const byName = new Map(
      (await listTags(db, TEST_USER_ID)).map((t) => [t.name, t]),
    )
    expect(byName.get("Go")!.repoCount).toBe(2)
    expect(byName.get("Go")!.totalRepoCount).toBe(2)
    expect(byName.get("语言")!.repoCount).toBe(1)
    expect(byName.get("语言")!.totalRepoCount).toBe(2)
  })

  it("returns the subtree ids", async () => {
    const db = await createTestDb()
    const lang = await createTag(db, TEST_USER_ID, "语言")
    const go = await createTag(db, TEST_USER_ID, "Go", null, lang.id)
    const gin = await createTag(db, TEST_USER_ID, "Gin", null, go.id)
    const other = await createTag(db, TEST_USER_ID, "其他")

    const subtree = await listTagSubtreeIds(db, TEST_USER_ID, lang.id)
    expect(subtree.sort()).toEqual([lang.id, go.id, gin.id].sort())
    expect(await listTagSubtreeIds(db, TEST_USER_ID, other.id)).toEqual([
      other.id,
    ])
    expect(await listTagSubtreeIds(db, TEST_USER_ID, 999999)).toEqual([])
  })

  it("rejects self reference, cycles and over-deep moves", async () => {
    const db = await createTestDb()
    const lang = await createTag(db, TEST_USER_ID, "语言")
    const go = await createTag(db, TEST_USER_ID, "Go", null, lang.id)

    await expect(
      updateTag(db, TEST_USER_ID, go.id, { parentId: go.id }),
    ).rejects.toThrow(TagHierarchyError)
    // 把「语言」挂到它自己的子标签「Go」下 = 成环
    await expect(
      updateTag(db, TEST_USER_ID, lang.id, { parentId: go.id }),
    ).rejects.toThrow(TagHierarchyError)
    await expect(
      updateTag(db, TEST_USER_ID, go.id, { parentId: 999999 }),
    ).rejects.toThrow(TagHierarchyError)
  })

  it("moves a tag to top level and to another parent", async () => {
    const db = await createTestDb()
    const lang = await createTag(db, TEST_USER_ID, "语言")
    const go = await createTag(db, TEST_USER_ID, "Go", null, lang.id)
    const tool = await createTag(db, TEST_USER_ID, "工具")

    await updateTag(db, TEST_USER_ID, go.id, { parentId: tool.id })
    let row = (await listTags(db, TEST_USER_ID)).find((t) => t.id === go.id)!
    expect(row.parentId).toBe(tool.id)
    expect(row.path).toBe("工具 / Go")

    await updateTag(db, TEST_USER_ID, go.id, { parentId: null })
    row = (await listTags(db, TEST_USER_ID)).find((t) => t.id === go.id)!
    expect(row.parentId).toBeNull()
    expect(row.depth).toBe(1)
  })

  it("keeps the parent untouched when parentId is omitted", async () => {
    const db = await createTestDb()
    const lang = await createTag(db, TEST_USER_ID, "语言")
    const go = await createTag(db, TEST_USER_ID, "Go", null, lang.id)

    await updateTag(db, TEST_USER_ID, go.id, { name: "Golang" })
    const row = (await listTags(db, TEST_USER_ID)).find((t) => t.id === go.id)!
    expect(row.name).toBe("Golang")
    expect(row.parentId).toBe(lang.id)
  })
})
