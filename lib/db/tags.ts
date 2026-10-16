import { and, eq, sql } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoTags, tags, userRepos } from "./schema"
import type { RepoSource } from "./repos"

export interface TagOption {
  id: number
  name: string
}

export interface TagWithCount extends TagOption {
  /** 标签描述，未填写时为 null */
  description: string | null
  repoCount: number
}

export interface TagUpdateInput {
  name?: string
  description?: string | null
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

export async function listTags(
  db: AppDatabase,
  userId: number,
  source?: RepoSource,
): Promise<TagWithCount[]> {
  const tagRows = await db
    .select({ id: tags.id, name: tags.name, description: tags.description })
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

  const countByTagId = new Map(countRows.map((row) => [row.tagId, row.count]))
  return tagRows.map((tag) => ({
    ...tag,
    repoCount: countByTagId.get(tag.id) ?? 0,
  }))
}

/**
 * 创建标签；同名标签已存在时直接返回已有的（幂等），不会覆盖其描述。
 * 调用方若需要区分"已存在"，请先查 findTagByName。
 */
export async function createTag(
  db: AppDatabase,
  userId: number,
  name: string,
  description?: string | null,
): Promise<TagOption> {
  const existing = await findTagByName(db, userId, name)
  if (existing) return existing

  const now = new Date().toISOString()
  const [inserted] = await db
    .insert(tags)
    .values({
      userId,
      name,
      description: normalizeDescription(description),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: tags.id })
  return { id: inserted.id, name }
}

/** 修改标签名称/描述；标签不存在时返回 null */
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

  if (nextName === current.name && nextDescription === current.description) {
    return { id: current.id, name: current.name }
  }

  await db
    .update(tags)
    .set({
      name: nextName,
      description: nextDescription,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
    .run()

  return { id: current.id, name: nextName }
}

/** 删除标签并清理所有仓库上的关联；标签不存在时返回 false */
export async function deleteTag(
  db: AppDatabase,
  userId: number,
  tagId: number,
): Promise<boolean> {
  const existing = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
    .get()
  if (!existing) return false

  await db.transaction(async (tx) => {
    await tx
      .delete(repoTags)
      .where(and(eq(repoTags.userId, userId), eq(repoTags.tagId, tagId)))
      .run()
    await tx
      .delete(tags)
      .where(and(eq(tags.userId, userId), eq(tags.id, tagId)))
      .run()
  })

  return true
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
