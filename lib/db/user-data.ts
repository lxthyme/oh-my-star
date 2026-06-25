import { and, eq } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoUserData } from "./schema"

export async function setFavorite(
  db: AppDatabase,
  userId: number,
  repoId: number,
  isFavorite: boolean,
): Promise<void> {
  await db
    .insert(repoUserData)
    .values({ userId, repoId, isFavorite: isFavorite ? 1 : 0 })
    .onConflictDoUpdate({
      target: [repoUserData.userId, repoUserData.repoId],
      set: { isFavorite: isFavorite ? 1 : 0 },
    })
    .run()
}

export async function setNote(
  db: AppDatabase,
  userId: number,
  repoId: number,
  note: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insert(repoUserData)
    .values({ userId, repoId, note, noteUpdatedAt: now })
    .onConflictDoUpdate({
      target: [repoUserData.userId, repoUserData.repoId],
      set: { note, noteUpdatedAt: now },
    })
    .run()
}

export async function getUserData(
  db: AppDatabase,
  userId: number,
  repoId: number,
): Promise<{ isFavorite: boolean; note: string | null }> {
  const row = await db
    .select()
    .from(repoUserData)
    .where(
      and(eq(repoUserData.userId, userId), eq(repoUserData.repoId, repoId)),
    )
    .get()
  return {
    isFavorite: row?.isFavorite === 1,
    note: row?.note ?? null,
  }
}
