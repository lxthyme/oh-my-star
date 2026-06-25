import { and, eq } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoTags, tags } from "./schema"

export interface TagOption {
  id: number
  name: string
}

export async function listTags(
  db: AppDatabase,
  userId: number,
): Promise<TagOption[]> {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(tags.name)
    .all()
}

export async function createTag(
  db: AppDatabase,
  userId: number,
  name: string,
): Promise<TagOption> {
  const existing = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.name, name)))
    .get()
  if (existing) return existing

  const now = new Date().toISOString()
  const [inserted] = await db
    .insert(tags)
    .values({ userId, name, createdAt: now })
    .returning({ id: tags.id })
  return { id: inserted.id, name }
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
