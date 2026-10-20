import { and, eq } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { gistUserData } from "./schema"

export async function setGistFavorite(
  db: AppDatabase,
  userId: number,
  gistId: string,
  isFavorite: boolean,
): Promise<void> {
  await db
    .insert(gistUserData)
    .values({ userId, gistId, isFavorite: isFavorite ? 1 : 0 })
    .onConflictDoUpdate({
      target: [gistUserData.userId, gistUserData.gistId],
      set: { isFavorite: isFavorite ? 1 : 0 },
    })
    .run()
}

export async function setGistNote(
  db: AppDatabase,
  userId: number,
  gistId: string,
  note: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insert(gistUserData)
    .values({ userId, gistId, note, noteUpdatedAt: now })
    .onConflictDoUpdate({
      target: [gistUserData.userId, gistUserData.gistId],
      set: { note, noteUpdatedAt: now },
    })
    .run()
}

export async function getGistUserData(
  db: AppDatabase,
  userId: number,
  gistId: string,
): Promise<{ isFavorite: boolean; note: string | null }> {
  const row = await db
    .select()
    .from(gistUserData)
    .where(
      and(eq(gistUserData.userId, userId), eq(gistUserData.gistId, gistId)),
    )
    .get()
  return {
    isFavorite: row?.isFavorite === 1,
    note: row?.note ?? null,
  }
}
