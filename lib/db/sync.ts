import type { AppDatabase } from "./client"
import { repos } from "./schema"
import type { GitHubRepoData, StarredRepoData } from "../github"

export interface SyncInput {
  owned: GitHubRepoData[]
  starred: StarredRepoData[]
}

export interface SyncResult {
  ownedCount: number
  starredCount: number
}

interface MergedEntry {
  repo: GitHubRepoData
  isOwned: boolean
  isStarred: boolean
  starredAt: string | null
}

export function syncRepos(db: AppDatabase, input: SyncInput): SyncResult {
  const merged = new Map<number, MergedEntry>()

  for (const repo of input.owned) {
    merged.set(repo.id, { repo, isOwned: true, isStarred: false, starredAt: null })
  }
  for (const { repo, starredAt } of input.starred) {
    const existing = merged.get(repo.id)
    merged.set(repo.id, {
      repo,
      isOwned: existing?.isOwned ?? false,
      isStarred: true,
      starredAt,
    })
  }

  const now = new Date().toISOString()

  db.transaction((tx) => {
    tx.update(repos).set({ isOwned: 0, isStarred: 0, starredAt: null }).run()

    for (const entry of merged.values()) {
      const values = {
        id: entry.repo.id,
        fullName: entry.repo.fullName,
        name: entry.repo.name,
        ownerLogin: entry.repo.ownerLogin,
        ownerAvatar: entry.repo.ownerAvatar,
        description: entry.repo.description,
        htmlUrl: entry.repo.htmlUrl,
        language: entry.repo.language,
        topics: JSON.stringify(entry.repo.topics),
        stargazersCount: entry.repo.stargazersCount,
        forksCount: entry.repo.forksCount,
        archived: entry.repo.archived ? 1 : 0,
        fork: entry.repo.fork ? 1 : 0,
        private: entry.repo.private ? 1 : 0,
        isTemplate: entry.repo.isTemplate ? 1 : 0,
        mirrorUrl: entry.repo.mirrorUrl,
        pushedAt: entry.repo.pushedAt,
        updatedAt: entry.repo.updatedAt,
        createdAt: entry.repo.createdAt,
        isOwned: entry.isOwned ? 1 : 0,
        isStarred: entry.isStarred ? 1 : 0,
        starredAt: entry.starredAt,
        syncedAt: now,
      }

      tx.insert(repos).values(values).onConflictDoUpdate({ target: repos.id, set: values }).run()
    }
  })

  return { ownedCount: input.owned.length, starredCount: input.starred.length }
}
