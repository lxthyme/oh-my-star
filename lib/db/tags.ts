import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { gistTags, repoTags, tags, userGists, userRepos } from "./schema"
import { ORPHAN_TAG_NAME, TAG_MAX_DEPTH } from "../tag-limits"

export interface TagOption {
  id: number
  name: string
}

/** 标签归属的实体类型：repo = 仓库标签，gist = Gist 标签 */
export type TagScope = "repo" | "gist"
/** 标签计数时按哪个来源统计，undefined = 不区分来源 */
export type TagSource = "owned" | "starred"

/** 标签用途标记：NULL 为普通标签；orphan = 承接被删父标签遗留子标签的专用标签 */
export type TagRole = "orphan" | null

export interface TagWithCount extends TagOption {
  /** 标签描述，未填写时为 null */
  description: string | null
  /**
   * 直接打上该标签的实体数。
   * 字段名沿用「仓库」，实际含义取决于 scope：gist 标签统计的是 Gist 数。
   */
  repoCount: number
  /**
   * 用途标记。按 role 而不是名称识别专用标签，改名后身份不会丢。
   */
  role: TagRole
  /** 父标签 id，顶级标签为 null */
  parentId: number | null
  /** 层级深度，顶级标签为 1 */
  depth: number
  /** 完整路径，如「工具 / CLI」；顶级标签即自身名称 */
  path: string
  /** 直接子标签数量 */
  childrenCount: number
  /** 含子孙标签的实体数（同一实体只计一次），含义同 repoCount 取决于 scope */
  totalRepoCount: number
}

/**
 * 标签关联的实体表：repo 与 gist 各有一套关联表，同名标签两个空间互不干扰。
 * gist 的主键是字符串，所以两套表的 id 列类型不同，这里统一取成列对象再拼 SQL。
 */
function assocTables(scope: TagScope) {
  return scope === "gist"
    ? {
        assoc: gistTags,
        assocTagId: gistTags.tagId,
        assocEntityId: gistTags.gistId,
        owner: userGists,
        ownerEntityId: userGists.gistId,
        owned: userGists.isOwned,
        starred: userGists.isStarred,
      }
    : {
        assoc: repoTags,
        assocTagId: repoTags.tagId,
        assocEntityId: repoTags.repoId,
        owner: userRepos,
        ownerEntityId: userRepos.repoId,
        owned: userRepos.isOwned,
        starred: userRepos.isStarred,
      }
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

/**
 * 既能接 `AppDatabase` 也能接事务对象，这样校验可以放进事务里执行，
 * 避免"先校验后写入"被并发打断。
 */
type TagQueryDb = Pick<AppDatabase, "all" | "select">

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
  scope: TagScope = "repo",
): Promise<TagOption | null> {
  const row = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(
      and(eq(tags.userId, userId), eq(tags.name, name), eq(tags.scope, scope)),
    )
    .get()
  return row ?? null
}

/**
 * 在同一层级内按名称查找标签：parentId 为 null 表示顶级，
 * 数字表示指定的父标签下。不同层级之间允许同名，故需要带 parentId。
 */
export async function findTagByNameAtLevel(
  db: AppDatabase,
  userId: number,
  name: string,
  parentId: number | null,
  scope: TagScope = "repo",
): Promise<TagOption | null> {
  const row = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(
      and(
        eq(tags.userId, userId),
        eq(tags.name, name),
        eq(tags.scope, scope),
        parentId === null ? isNull(tags.parentId) : eq(tags.parentId, parentId),
      ),
    )
    .get()
  return row ?? null
}

/** 取标签的完整基本字段；标签不存在时返回 null */
export async function findTagById(
  db: AppDatabase,
  userId: number,
  tagId: number,
): Promise<{
  id: number
  name: string
  parentId: number | null
  scope: TagScope
} | null> {
  const row = await db
    .select({
      id: tags.id,
      name: tags.name,
      parentId: tags.parentId,
      scope: tags.scope,
    })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
    .get()
  return row ?? null
}

/** 取标签归属的实体类型；标签不存在时返回 null */
export async function findTagScope(
  db: AppDatabase,
  userId: number,
  tagId: number,
): Promise<TagScope | null> {
  const row = await db
    .select({ scope: tags.scope })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
    .get()
  return row?.scope ?? null
}

/**
 * 递归 CTE：取某标签的子树 id 集合（含自身）。
 * 必须带 depth 上限——数据一旦成环，无上限的 CTE 会无限递归。
 */
export async function listTagSubtreeIds(
  db: TagQueryDb,
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
  db: TagQueryDb,
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
  db: TagQueryDb,
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
  db: TagQueryDb,
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
  source?: TagSource,
  scope: TagScope = "repo",
): Promise<TagWithCount[]> {
  const tagRows = await db
    .select({
      id: tags.id,
      name: tags.name,
      description: tags.description,
      parentId: tags.parentId,
      role: tags.role,
    })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.scope, scope)))
    .orderBy(tags.name)
    .all()

  const assoc = assocTables(scope)
  const countRows = await db.all<{ tagId: number; count: number }>(sql`
    SELECT ${assoc.assocTagId} AS tagId, COUNT(*) AS count
    FROM ${assoc.assoc}
    JOIN ${assoc.owner}
      ON ${assoc.owner.userId} = ${userId}
      AND ${assoc.ownerEntityId} = ${assoc.assocEntityId}
    WHERE ${assoc.assoc.userId} = ${userId}
      ${source === "owned" ? sql`AND ${assoc.owned} = 1` : sql``}
      ${source === "starred" ? sql`AND ${assoc.starred} = 1` : sql``}
    GROUP BY ${assoc.assocTagId}
  `)

  const repoCountByTagId = new Map(
    countRows.map((row) => [row.tagId, row.count]),
  )
  const rowById = new Map(tagRows.map((row) => [row.id, row]))
  const hasHierarchy = tagRows.some(
    (row) => row.parentId !== null && rowById.has(row.parentId),
  )

  // 含子级的仓库数由 SQL 递归聚合，避免把成千上万行 repo_tags 拉进 JS。
  // 没有任何层级时含子级就等于自身数量，省掉这次查询。
  const totalRepoCountById = hasHierarchy
    ? await countTotalItemsByTagId(db, userId, source, scope)
    : new Map<number, number>()

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

  return tagRows.map((tag) => {
    const repoCount = repoCountByTagId.get(tag.id) ?? 0
    return {
      id: tag.id,
      name: tag.name,
      description: tag.description,
      repoCount,
      role: tag.role ?? null,
      parentId: tag.parentId,
      depth: depthById.get(tag.id) ?? 1,
      path: pathById.get(tag.id) ?? tag.name,
      childrenCount: childrenCountById.get(tag.id) ?? 0,
      totalRepoCount: totalRepoCountById.get(tag.id) ?? repoCount,
    }
  })
}

/**
 * 每个标签含子孙的实体数（同一实体经多条命中路径只算一次）。
 * 递归 CTE 展开子树后再 COUNT(DISTINCT 实体 id)，带 depth 上限防成环。
 */
async function countTotalItemsByTagId(
  db: AppDatabase,
  userId: number,
  source?: TagSource,
  scope: TagScope = "repo",
): Promise<Map<number, number>> {
  const assoc = assocTables(scope)

  const rows = await db.all<{ tagId: number; total: number }>(sql`
    WITH RECURSIVE sub(root_id, tag_id, depth) AS (
      SELECT ${tags.id}, ${tags.id}, 0 FROM ${tags}
      WHERE ${tags.userId} = ${userId} AND ${tags.scope} = ${scope}
      UNION ALL
      SELECT sub.root_id, t.id, sub.depth + 1 FROM ${tags} t JOIN sub ON t.parent_id = sub.tag_id
      WHERE t.user_id = ${userId} AND t.scope = ${scope} AND sub.depth < ${TAG_MAX_DEPTH}
    )
    SELECT sub.root_id AS tagId, COUNT(DISTINCT ${assoc.assocEntityId}) AS total
    FROM sub
    JOIN ${assoc.assoc} ON ${assoc.assoc.userId} = ${userId} AND ${assoc.assocTagId} = sub.tag_id
    JOIN ${assoc.owner} ON ${assoc.owner.userId} = ${userId} AND ${assoc.ownerEntityId} = ${assoc.assocEntityId}
      ${source === "owned" ? sql`AND ${assoc.owned} = 1` : sql``}
      ${source === "starred" ? sql`AND ${assoc.starred} = 1` : sql``}
    GROUP BY sub.root_id
  `)

  return new Map(rows.map((row) => [row.tagId, row.total]))
}

/**
 * 创建标签；同一层级下同名标签已存在时直接返回已有的（幂等），不会覆盖其描述。
 * 不同层级之间允许同名，因此幂等判断带上 parentId。
 * 调用方若需要区分"已存在"，请先查 findTagByNameAtLevel。
 * parentId 省略或为 null 时创建顶级标签。
 */
export async function createTag(
  db: AppDatabase,
  userId: number,
  name: string,
  description?: string | null,
  parentId?: number | null,
  scope: TagScope = "repo",
): Promise<TagOption> {
  const existing = await findTagByNameAtLevel(db, userId, name, parentId ?? null, scope)
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
      scope,
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
      role: tags.role,
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

  if (parentProvided && current.role === "orphan") {
    throw new TagHierarchyError(
      `「${current.name}」是专用标签，不支持变更层级`,
    )
  }

  if (
    nextName === current.name &&
    nextDescription === current.description &&
    !parentProvided
  ) {
    return { id: current.id, name: current.name }
  }

  // 校验与写入必须在同一事务里：分开做的话，两个请求并发互挂父子都能通过校验，
  // 然后各自写入形成环，而无上限的递归 CTE 成环会把进程跑到 OOM。
  await db.transaction(async (tx) => {
    if (parentProvided) {
      await assertValidParent(tx, userId, tagId, input.parentId ?? null)
    }
    await tx
      .update(tags)
      .set({
        name: nextName,
        description: nextDescription,
        parentId: nextParentId ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
      .run()
  })

  return { id: current.id, name: nextName }
}

/** 取（必要时创建）承接"父标签被删除后遗留子标签"的专用标签，身份由 role 标记 */
async function getOrCreateOrphanTag(
  db: AppDatabase,
  userId: number,
  scope: TagScope,
): Promise<TagOption> {
  const byRole = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(
      and(eq(tags.userId, userId), eq(tags.role, "orphan"), eq(tags.scope, scope)),
    )
    .get()
  if (byRole) return byRole

  // 兼容：role 列上线前若已有同名标签，直接把它升为专用标签，避免重名冲突
  const byName = await findTagByName(db, userId, ORPHAN_TAG_NAME, scope)
  if (byName) {
    await db
      .update(tags)
      .set({ role: "orphan" })
      .where(and(eq(tags.userId, userId), eq(tags.id, byName.id)))
      .run()
    return byName
  }

  const now = new Date().toISOString()
  const [inserted] = await db
    .insert(tags)
    .values({
      userId,
      name: ORPHAN_TAG_NAME,
      description: "父标签被删除后，子标签会先移到这里，可手动调整归属",
      scope,
      role: "orphan",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: tags.id })
  return { id: inserted.id, name: ORPHAN_TAG_NAME }
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
    .select({ id: tags.id, name: tags.name, role: tags.role, scope: tags.scope })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
    .get()
  if (!existing) return { ok: false, movedChildren: 0 }
  if (existing.role === "orphan") {
    // 专用标签是遗留子标签的落点，删掉就没人承接了，因此禁止删除。
    // 想处理它下面的标签，请先把它们移到其他父级下。
    throw new TagHierarchyError(`「${existing.name}」是专用标签，不支持删除`)
  }

  const children = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.parentId, tagId)))
    .all()

  // 专用标签在事务外先准备好，避免在事务里嵌套创建
  const orphan =
    children.length > 0
      ? await getOrCreateOrphanTag(db, userId, existing.scope)
      : null

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

    // 标签只有一个 scope，但两套关联表都清一遍，避免历史数据残留导致孤儿行
    await tx
      .delete(repoTags)
      .where(and(eq(repoTags.userId, userId), eq(repoTags.tagId, tagId)))
      .run()
    await tx
      .delete(gistTags)
      .where(and(eq(gistTags.userId, userId), eq(gistTags.tagId, tagId)))
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

/**
 * 整体覆盖某个 repo 的标签集合。
 * tagIds 为已存在标签的 id（需属于当前用户，且 scope 为 repo）；
 * newTagNames 为需要新建的标签名（建在顶级）。
 * 返回最终关联的所有标签。
 */
export async function setRepoTags(
  db: AppDatabase,
  userId: number,
  repoId: number,
  tagIds: number[],
  newTagNames: string[] = [],
): Promise<TagOption[]> {
  const created: TagOption[] = []
  const uniqueNames = [
    ...new Set(newTagNames.map((name) => name.trim()).filter(Boolean)),
  ]
  for (const name of uniqueNames) {
    created.push(await createTag(db, userId, name))
  }

  // 只关联属于当前用户、且为 repo 命名空间的已有标签，避免把他人标签挂过来
  const ownedIds = new Set<number>(created.map((tag) => tag.id))
  const requestedIds = [...new Set(tagIds)]
  if (requestedIds.length > 0) {
    const rows = await db
      .select({ id: tags.id })
      .from(tags)
      .where(
        and(
          eq(tags.userId, userId),
          eq(tags.scope, "repo"),
          inArray(tags.id, requestedIds),
        ),
      )
      .all()
    for (const row of rows) ownedIds.add(row.id)
  }

  const finalIds = [...ownedIds]

  await db.transaction(async (tx) => {
    await tx
      .delete(repoTags)
      .where(and(eq(repoTags.repoId, repoId), eq(repoTags.userId, userId)))
      .run()
    for (const tagId of finalIds) {
      await tx.insert(repoTags).values({ userId, repoId, tagId }).run()
    }
  })

  if (finalIds.length === 0) return []
  return db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(inArray(tags.id, finalIds))
    .all()
}
