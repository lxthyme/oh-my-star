import { describe, expect, it } from "vitest"
import { createDb, type AppDatabase } from "./client"
import { repos } from "./schema"
import { setFavorite, setNote, getUserData } from "./user-data"

const createTestRepo = (db: AppDatabase, id: number) => {
  db.insert(repos)
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
  it("creates a repo_user_data row on first call", () => {
    const db = createDb(":memory:")
    createTestRepo(db, 1)
    setFavorite(db, 1, true)
    expect(getUserData(db, 1)).toEqual({ isFavorite: true, note: null })
  })

  it("toggles favorite without affecting an existing note", () => {
    const db = createDb(":memory:")
    createTestRepo(db, 1)
    setNote(db, 1, "记得看看")
    setFavorite(db, 1, true)
    setFavorite(db, 1, false)
    expect(getUserData(db, 1)).toEqual({ isFavorite: false, note: "记得看看" })
  })
})

describe("setNote", () => {
  it("creates a repo_user_data row on first call", () => {
    const db = createDb(":memory:")
    createTestRepo(db, 1)
    setNote(db, 1, "值得学习的项目")
    expect(getUserData(db, 1)).toEqual({
      isFavorite: false,
      note: "值得学习的项目",
    })
  })

  it("overwrites the previous note without affecting favorite status", () => {
    const db = createDb(":memory:")
    createTestRepo(db, 1)
    setFavorite(db, 1, true)
    setNote(db, 1, "first")
    setNote(db, 1, "second")
    expect(getUserData(db, 1)).toEqual({ isFavorite: true, note: "second" })
  })
})

describe("getUserData", () => {
  it("returns defaults for a repo with no user data yet", () => {
    const db = createDb(":memory:")
    createTestRepo(db, 999)
    expect(getUserData(db, 999)).toEqual({ isFavorite: false, note: null })
  })
})
