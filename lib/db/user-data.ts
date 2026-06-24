import { eq } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoUserData } from "./schema"

export function setFavorite(db: AppDatabase, repoId: number, isFavorite: boolean): void {
  db.insert(repoUserData)
    .values({ repoId, isFavorite: isFavorite ? 1 : 0 })
    .onConflictDoUpdate({
      target: repoUserData.repoId,
      set: { isFavorite: isFavorite ? 1 : 0 },
    })
    .run()
}

export function setNote(db: AppDatabase, repoId: number, note: string): void {
  const now = new Date().toISOString()
  db.insert(repoUserData)
    .values({ repoId, note, noteUpdatedAt: now })
    .onConflictDoUpdate({
      target: repoUserData.repoId,
      set: { note, noteUpdatedAt: now },
    })
    .run()
}

export function getUserData(db: AppDatabase, repoId: number): { isFavorite: boolean; note: string | null } {
  const row = db.select().from(repoUserData).where(eq(repoUserData.repoId, repoId)).get()
  return {
    isFavorite: row?.isFavorite === 1,
    note: row?.note ?? null,
  }
}
