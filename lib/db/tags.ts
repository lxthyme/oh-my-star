import { and, eq, ne, sql } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoTags, tags, userRepos } from "./schema"
import type { RepoSource } from "./repos"
import { ORPHAN_TAG_NAME, TAG_MAX_DEPTH } from "../tag-limits"

export interface TagOption {
  id: number
  name: string
}

export interface TagWithCount extends TagOption {
  /** 标签描述，未填写时为 null */
  description: string | null
  /** 直接打上该标签的仓库数 */
  repoCount: number
  /** 父标签 id，顶级标签为 null */
  parentId: number | null
  /** 层级深度，顶级标签为 1 */
  depth: number
  /** 完整路径，如「工具 / CLI」；顶级标签即自身名称 */
  path: string
  /** 直接子标签数量 */
  childrenCount: number
  /** 含子孙标签的仓库数（同一仓库只计一次） */
  totalRepoCount: number
}

export interface TagUpdateInput {
  name?: string
  description?: string | null
  /**
   * 父标签：
   * - undefined：不修改层级（保持现有 PATCH 语义）
   * - null：移到顶级
   * - 数字：指定父标签
   */
  parentId?: number | null
}

/** 层级校验失败（自引用、成环、超深、父级不存在等），由接口层转成 400 */
export class TagHierarchyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TagHierarchyError"
  }
}

/** 空字符串与纯空白统一存为 null，方便前端直接渲染 */
function normalizeDescription(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function findTagByName(
  db: AppDatabase,
  userId: number,
  name: string,
): Promise<TagOption | null> {
  const row = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.name, name)))
    .get()
  return row ?? null
}

/**
 * 递归 CTE：取某标签的子树 id 集合（含自身）。
 * 必须带 depth 上限——数据一旦成环，无上限的 CTE 会无限递归。
 */
export async function listTagSubtreeIds(
  db: AppDatabase,
  userId: number,
  tagId: number,
): Promise<number[]> {
  const rows = await db.all<{ id: number }>(sql`
    WITH RECURSIVE sub(id, depth) AS (
      SELECT ${tags.id}, 0 FROM ${tags}
      WHERE ${tags.id} = ${tagId} AND ${tags.userId} = ${userId}
      UNION ALL
      SELECT t.id, sub.depth + 1 FROM ${tags} t JOIN sub ON t.parent_id = sub.id
      WHERE t.user_id = ${userId} AND sub.depth < ${TAG_MAX_DEPTH}
    )
    SELECT id FROM sub
  `)
  return [...new Set(rows.map((row) => row.id))]
}

/** 递归 CTE：取某标签的祖先链（含自身，顺序为「自身 → 父 → ... → 顶级」） */
export async function listTagAncestorIds(
  db: AppDatabase,
  userId: number,
  tagId: number,
): Promise<number[]> {
  const rows = await db.all<{ id: number }>(sql`
    WITH RECURSIVE up(id, parent_id, depth) AS (
      SELECT ${tags.id}, ${tags.parentId}, 0 FROM ${tags}
      WHERE ${tags.id} = ${tagId} AND ${tags.userId} = ${userId}
      UNION ALL
      SELECT t.id, t.parent_id, up.depth + 1 FROM ${tags} t JOIN up ON t.id = up.parent_id
      WHERE t.user_id = ${userId} AND up.depth < ${TAG_MAX_DEPTH}
    )
    SELECT id FROM up
  `)
  return [...new Set(rows.map((row) => row.id))]
}

/** 子树高度：叶子为 1 */
async function getSubtreeHeight(
  db: AppDatabase,
  userId: number,
  tagId: number,
): Promise<number> {
  const rows = await db.all<{ height: number }>(sql`
    WITH RECURSIVE sub(id, depth) AS (
      SELECT ${tags.id}, 0 FROM ${tags}
      WHERE ${tags.id} = ${tagId} AND ${tags.userId} = ${userId}
      UNION ALL
      SELECT t.id, sub.depth + 1 FROM ${tags} t JOIN sub ON t.parent_id = sub.id
      WHERE t.user_id = ${userId} AND sub.depth < ${TAG_MAX_DEPTH}
    )
    SELECT MAX(depth) + 1 AS height FROM sub
  `)
  return rows[0]?.height ?? 1
}

/** 校验把 tagId 放到 parentId 下是否合法，不合法时抛 TagHierarchyError */
async function assertValidParent(
  db: AppDatabase,
  userId: number,
  tagId: number,
  parentId: number | null,
): Promise<void> {
  if (parentId === null) return
  if (parentId === tagId) {
    throw new TagHierarchyError("不能把标签设为自己的父标签")
  }

  const parent = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.id, parentId)))
    .get()
  if (!parent) throw new TagHierarchyError("父标签不存在")

  const ancestors = await listTagAncestorIds(db, userId, parentId)
  if (ancestors.includes(tagId)) {
    throw new TagHierarchyError("不能把标签移动到它自己的子标签下")
  }

  const parentDepth = ancestors.length
  const height = await getSubtreeHeight(db, userId, tagId)
  if (parentDepth + height > TAG_MAX_DEPTH) {
    throw new TagHierarchyError(`标签层级最多 ${TAG_MAX_DEPTH} 级`)
  }
}

export async function listTags(
  db: AppDatabase,
  userId: number,
  source?: RepoSource,
): Promise<TagWithCount[]> {
  const tagRows = await db
    .select({
      id: tags.id,
      name: tags.name,
      description: tags.description,
      parentId: tags.parentId,
    })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(tags.name)
    .all()

  const countRows = await db
    .select({ tagId: repoTags.tagId, count: sql<number>`count(*)` })
    .from(repoTags)
    .innerJoin(
      userRepos,
      and(
        eq(userRepos.repoId, repoTags.repoId),
        eq(userRepos.userId, repoTags.userId),
      ),
    )
    .where(
      and(
        eq(repoTags.userId, userId),
        source === "owned"
          ? eq(userRepos.isOwned, 1)
          : source === "starred"
            ? eq(userRepos.isStarred, 1)
            : undefined,
      ),
    )
    .groupBy(repoTags.tagId)
    .all()

  const repoCountByTagId = new Map(
    countRows.map((row) => [row.tagId, row.count]),
  )
  const rowById = new Map(tagRows.map((row) => [row.id, row]))
  const hasHierarchy = tagRows.some(
    (row) => row.parentId !== null && rowById.has(row.parentId),
  )

  // 计算含子级的仓库数需要先知道每个标签下有哪些仓库；
  // 没有任何层级时直接等于自身数量，省掉这次查询。
  const reposByTagId = hasHierarchy
    ? await listReposByTagId(db, userId, source)
    : null

  const depthById = new Map<number, number>()
  const pathById = new Map<number, string>()
  const childrenCountById = new Map<number, number>()
  const childrenById = new Map<number, number[]>()

  for (const row of tagRows) {
    childrenCountById.set(row.id, 0)
  }

  for (const row of tagRows) {
    const parentId =
      row.parentId !== null && rowById.has(row.parentId) ? row.parentId : null
    if (parentId !== null) {
      const siblings = childrenById.get(parentId) ?? []
      siblings.push(row.id)
      childrenById.set(parentId, siblings)
      childrenCountById.set(
        parentId,
        (childrenCountById.get(parentId) ?? 0) + 1,
      )
    }
  }

  for (const row of tagRows) {
    // 向上回溯求深度与路径，带自环/成环保护
    const chain: string[] = []
    const seen = new Set<number>()
    let cursor: number | null = row.id
    let guard = 0
    while (
      cursor !== null &&
      !seen.has(cursor) &&
      guard++ <= TAG_MAX_DEPTH + 1
    ) {
      seen.add(cursor)
      const current = rowById.get(cursor)
      if (!current) break
      chain.unshift(current.name)
      const parentId = current.parentId
      cursor =
        parentId !== null && rowById.has(parentId) && parentId !== current.id
          ? parentId
          : null
    }
    depthById.set(row.id, chain.length)
    pathById.set(row.id, chain.join(" / "))
  }

  // 由深到浅合并子孙的仓库集合，同一仓库只计一次
  const totalRepoCountById = new Map<number, number>()
  if (reposByTagId) {
    const ordered = [...tagRows].sort(
      (a, b) => (depthById.get(b.id) ?? 1) - (depthById.get(a.id) ?? 1),
    )
    for (const row of ordered) {
      const merged = new Set(reposByTagId.get(row.id) ?? [])
      for (const childId of childrenById.get(row.id) ?? []) {
        const childTotal = reposByTagId.get(childId)
        if (childTotal) for (const id of childTotal) merged.add(id)
      }
      reposByTagId.set(row.id, merged)
      totalRepoCountById.set(row.id, merged.size)
    }
  }

  return tagRows.map((tag) => {
    const repoCount = repoCountByTagId.get(tag.id) ?? 0
    return {
      id: tag.id,
      name: tag.name,
      description: tag.description,
      repoCount,
      parentId: tag.parentId,
      depth: depthById.get(tag.id) ?? 1,
      path: pathById.get(tag.id) ?? tag.name,
      childrenCount: childrenCountById.get(tag.id) ?? 0,
      totalRepoCount: totalRepoCountById.get(tag.id) ?? repoCount,
    }
  })
}

async function listReposByTagId(
  db: AppDatabase,
  userId: number,
  source?: RepoSource,
): Promise<Map<number, Set<number>>> {
  const rows = await db
    .select({ tagId: repoTags.tagId, repoId: repoTags.repoId })
    .from(repoTags)
    .innerJoin(
      userRepos,
      and(
        eq(userRepos.repoId, repoTags.repoId),
        eq(userRepos.userId, repoTags.userId),
      ),
    )
    .where(
      and(
        eq(repoTags.userId, userId),
        source === "owned"
          ? eq(userRepos.isOwned, 1)
          : source === "starred"
            ? eq(userRepos.isStarred, 1)
            : undefined,
      ),
    )
    .all()

  const result = new Map<number, Set<number>>()
  for (const row of rows) {
    const set = result.get(row.tagId) ?? new Set<number>()
    set.add(row.repoId)
    result.set(row.tagId, set)
  }
  return result
}

/**
 * 创建标签；同名标签已存在时直接返回已有的（幂等），不会覆盖其描述。
 * 调用方若需要区分"已存在"，请先查 findTagByName。
 * parentId 省略或为 null 时创建顶级标签。
 */
export async function createTag(
  db: AppDatabase,
  userId: number,
  name: string,
  description?: string | null,
  parentId?: number | null,
): Promise<TagOption> {
  const existing = await findTagByName(db, userId, name)
  if (existing) return existing

  if (parentId !== undefined && parentId !== null) {
    const ancestors = await listTagAncestorIds(db, userId, parentId)
    if (ancestors.length === 0) throw new TagHierarchyError("父标签不存在")
    // 新标签是叶子，落到父级下后自身深度为 parentDepth + 1
    if (ancestors.length + 1 > TAG_MAX_DEPTH) {
      throw new TagHierarchyError(`标签层级最多 ${TAG_MAX_DEPTH} 级`)
    }
  }

  const now = new Date().toISOString()
  const [inserted] = await db
    .insert(tags)
    .values({
      userId,
      name,
      description: normalizeDescription(description),
      parentId: parentId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: tags.id })
  return { id: inserted.id, name }
}

/** 修改标签名称/描述/层级；标签不存在时返回 null */
export async function updateTag(
  db: AppDatabase,
  userId: number,
  tagId: number,
  input: TagUpdateInput,
): Promise<TagOption | null> {
  const current = await db
    .select({
      id: tags.id,
      name: tags.name,
      description: tags.description,
      parentId: tags.parentId,
    })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
    .get()
  if (!current) return null

  const nextName =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : current.name
  const nextDescription =
    input.description !== undefined
      ? normalizeDescription(input.description)
      : current.description
  const parentProvided = input.parentId !== undefined
  const nextParentId = parentProvided ? input.parentId : current.parentId

  if (parentProvided) {
    await assertValidParent(db, userId, tagId, input.parentId ?? null)
  }

  if (
    nextName === current.name &&
    nextDescription === current.description &&
    !parentProvided
  ) {
    return { id: current.id, name: current.name }
  }

  await db
    .update(tags)
    .set({
      name: nextName,
      description: nextDescription,
      parentId: nextParentId ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
    .run()

  return { id: current.id, name: nextName }
}

/** 取（必要时创建）承接"父标签被删除后遗留子标签"的专用标签 */
async function getOrCreateOrphanTag(
  db: AppDatabase,
  userId: number,
): Promise<TagOption> {
  const existing = await findTagByName(db, userId, ORPHAN_TAG_NAME)
  if (existing) return existing
  return createTag(
    db,
    userId,
    ORPHAN_TAG_NAME,
    "父标签被删除后，子标签会先移到这里，可手动调整归属",
  )
}

/**
 * 删除标签并清理所有仓库上的关联。
 * 若存在直接子标签，先把它们移到专用标签「已删除待处理」下，整个过程在同一事务内。
 * 「已删除待处理」本身不支持删除，调用方会收到 TagHierarchyError。
 * 标签不存在时返回 { ok: false }
 */
export async function deleteTag(
  db: AppDatabase,
  userId: number,
  tagId: number,
): Promise<{ ok: boolean; movedChildren: number }> {
  const existing = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
    .get()
  if (!existing) return { ok: false, movedChildren: 0 }
  if (existing.name === ORPHAN_TAG_NAME) {
    // 专用标签是登记表的落点，删掉就没人承接遗留子标签了，因此禁止删除。
    // 想处理它下面的标签，请先把它们移到其他父级下。
    throw new TagHierarchyError(`「${ORPHAN_TAG_NAME}」是专用标签，不支持删除`)
  }

  const children = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.parentId, tagId)))
    .all()

  // 专用标签在事务外先准备好，避免在事务里嵌套创建
  const orphan =
    children.length > 0 ? await getOrCreateOrphanTag(db, userId) : null

  const movedChildren = await db.transaction(async (tx) => {
    if (orphan) {
      await tx
        .update(tags)
        .set({ parentId: orphan.id })
        .where(
          and(
            eq(tags.userId, userId),
            eq(tags.parentId, tagId),
            ne(tags.id, orphan.id),
          ),
        )
        .run()
      // 专用标签若正好是待删除标签的子标签，提升为顶级，避免自引用
      await tx
        .update(tags)
        .set({ parentId: null })
        .where(
          and(
            eq(tags.userId, userId),
            eq(tags.id, orphan.id),
            eq(tags.parentId, tagId),
          ),
        )
        .run()
    }

    await tx
      .delete(repoTags)
      .where(and(eq(repoTags.userId, userId), eq(repoTags.tagId, tagId)))
      .run()
    await tx
      .delete(tags)
      .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
      .run()

    return children.length
  })

  return { ok: true, movedChildren }
}

export async function getRepoTags(
  db: AppDatabase,
  userId: number,
  repoId: number,
): Promise<TagOption[]> {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(repoTags)
    .innerJoin(tags, eq(tags.id, repoTags.tagId))
    .where(and(eq(repoTags.repoId, repoId), eq(repoTags.userId, userId)))
    .orderBy(tags.name)
    .all()
}

export async function setRepoTags(
  db: AppDatabase,
  userId: number,
  repoId: number,
  tagNames: string[],
): Promise<TagOption[]> {
  const uniqueNames = [
    ...new Set(tagNames.map((name) => name.trim()).filter(Boolean)),
  ]
  const resolved: TagOption[] = []
  for (const name of uniqueNames) {
    resolved.push(await createTag(db, userId, name))
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(repoTags)
      .where(and(eq(repoTags.repoId, repoId), eq(repoTags.userId, userId)))
      .run()
    for (const tag of resolved) {
      await tx.insert(repoTags).values({ userId, repoId, tagId: tag.id }).run()
    }
  })

  return resolved
}
