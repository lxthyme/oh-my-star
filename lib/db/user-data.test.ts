import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { repos } from "./schema"
import { setFavorite, setNote, getUserData } from "./user-data"

const TEST_USER_ID = 1001

const createTestRepo = async (db: AppDatabase, id: number) => {
  await db
    .insert(repos)
    .values({
      id,
      fullName: `test/repo${id}`,
      name: `repo${id}`,
      ownerLogin: "test",
      htmlUrl: "https://github.com/test/repo",
    })
    .run()
}

describe("setFavorite", () => {
  it("creates a repo_user_data row on first call", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setFavorite(db, TEST_USER_ID, 1, true)
    expect(await getUserData(db, TEST_USER_ID, 1)).toEqual({
      isFavorite: true,
      note: null,
    })
  })

  it("toggles favorite without affecting an existing note", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setNote(db, TEST_USER_ID, 1, "记得看看")
    await setFavorite(db, TEST_USER_ID, 1, true)
    await setFavorite(db, TEST_USER_ID, 1, false)
    expect(await getUserData(db, TEST_USER_ID, 1)).toEqual({
      isFavorite: false,
      note: "记得看看",
    })
  })
})

describe("setNote", () => {
  it("creates a repo_user_data row on first call", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setNote(db, TEST_USER_ID, 1, "值得学习的项目")
    expect(await getUserData(db, TEST_USER_ID, 1)).toEqual({
      isFavorite: false,
      note: "值得学习的项目",
    })
  })

  it("overwrites the previous note without affecting favorite status", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setFavorite(db, TEST_USER_ID, 1, true)
    await setNote(db, TEST_USER_ID, 1, "first")
    await setNote(db, TEST_USER_ID, 1, "second")
    expect(await getUserData(db, TEST_USER_ID, 1)).toEqual({
      isFavorite: true,
      note: "second",
    })
  })
})

describe("getUserData", () => {
  it("returns defaults for a repo with no user data yet", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 999)
    expect(await getUserData(db, TEST_USER_ID, 999)).toEqual({
      isFavorite: false,
      note: null,
    })
  })

  it("keeps data isolated between different users", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setFavorite(db, TEST_USER_ID, 1, true)
    expect(await getUserData(db, 2002, 1)).toEqual({
      isFavorite: false,
      note: null,
    })
  })
})
