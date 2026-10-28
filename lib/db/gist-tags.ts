import { and, eq, inArray } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { gistTags, tags } from "./schema"
import { createTag, type TagOption } from "./tags"

export async function getGistTags(
  db: AppDatabase,
  userId: number,
  gistId: string,
): Promise<TagOption[]> {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(gistTags)
    .innerJoin(tags, eq(tags.id, gistTags.tagId))
    .where(and(eq(gistTags.gistId, gistId), eq(gistTags.userId, userId)))
    .orderBy(tags.name)
    .all()
}

/**
 * 整体覆盖某个 gist 的标签。
 * 标签建在 gist 命名空间下（scope="gist"），与仓库标签同名也不会互相干扰。
 * tagIds 为已存在标签的 id（需属于当前用户，且 scope 为 gist）；
 * newTagNames 为需要新建的标签名（建在顶级）。
 * 返回最终关联的所有标签。
 */
export async function setGistTags(
  db: AppDatabase,
  userId: number,
  gistId: string,
  tagIds: number[],
  newTagNames: string[] = [],
): Promise<TagOption[]> {
  const created: TagOption[] = []
  const uniqueNames = [
    ...new Set(newTagNames.map((name) => name.trim()).filter(Boolean)),
  ]
  for (const name of uniqueNames) {
    created.push(await createTag(db, userId, name, null, null, "gist"))
  }

  // 只关联属于当前用户、且为 gist 命名空间的已有标签
  const ownedIds = new Set<number>(created.map((tag) => tag.id))
  const requestedIds = [...new Set(tagIds)]
  if (requestedIds.length > 0) {
    const rows = await db
      .select({ id: tags.id })
      .from(tags)
      .where(
        and(
          eq(tags.userId, userId),
          eq(tags.scope, "gist"),
          inArray(tags.id, requestedIds),
        ),
      )
      .all()
    for (const row of rows) ownedIds.add(row.id)
  }

  const finalIds = [...ownedIds]

  await db.transaction(async (tx) => {
    await tx
      .delete(gistTags)
      .where(and(eq(gistTags.gistId, gistId), eq(gistTags.userId, userId)))
      .run()
    for (const tagId of finalIds) {
      await tx.insert(gistTags).values({ userId, gistId, tagId }).run()
    }
  })

  if (finalIds.length === 0) return []
  return db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(inArray(tags.id, finalIds))
    .all()
}
