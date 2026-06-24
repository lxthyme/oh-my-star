import { eq } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoTags, tags } from "./schema"

export interface TagOption {
  id: number
  name: string
}

export function listTags(db: AppDatabase): TagOption[] {
  return db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(tags.name).all()
}

export function createTag(db: AppDatabase, name: string): TagOption {
  const existing = db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.name, name)).get()
  if (existing) return existing

  const now = new Date().toISOString()
  const result = db.insert(tags).values({ name, createdAt: now }).run()
  return { id: Number(result.lastInsertRowid), name }
}

export function getRepoTags(db: AppDatabase, repoId: number): TagOption[] {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(repoTags)
    .innerJoin(tags, eq(tags.id, repoTags.tagId))
    .where(eq(repoTags.repoId, repoId))
    .orderBy(tags.name)
    .all()
}

export function setRepoTags(db: AppDatabase, repoId: number, tagNames: string[]): TagOption[] {
  const uniqueNames = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))]
  const resolved = uniqueNames.map((name) => createTag(db, name))

  db.transaction((tx) => {
    tx.delete(repoTags).where(eq(repoTags.repoId, repoId)).run()
    for (const tag of resolved) {
      tx.insert(repoTags).values({ repoId, tagId: tag.id }).run()
    }
  })

  return resolved
}
