import { and, eq } from "drizzle-orm"
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
 */
export async function setGistTags(
  db: AppDatabase,
  userId: number,
  gistId: string,
  tagNames: string[],
): Promise<TagOption[]> {
  const uniqueNames = [
    ...new Set(tagNames.map((name) => name.trim()).filter(Boolean)),
  ]
  const resolved: TagOption[] = []
  for (const name of uniqueNames) {
    resolved.push(await createTag(db, userId, name, null, null, "gist"))
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(gistTags)
      .where(and(eq(gistTags.gistId, gistId), eq(gistTags.userId, userId)))
      .run()
    for (const tag of resolved) {
      await tx
        .insert(gistTags)
        .values({ userId, gistId, tagId: tag.id })
        .run()
    }
  })

  return resolved
}
