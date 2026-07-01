import { eq, sql } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repos, userRepos } from "./schema"
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

// SQLite SQLITE_MAX_VARIABLE_NUMBER defaults to 32766; chunk to stay safe.
// repos has 19 columns → 500 rows × 19 = 9500 variables per batch.
const CHUNK_SIZE = 500

export async function syncRepos(
  db: AppDatabase,
  userId: number,
  input: SyncInput,
): Promise<SyncResult> {
  const merged = new Map<number, MergedEntry>()

  for (const repo of input.owned) {
    merged.set(repo.id, {
      repo,
      isOwned: true,
      isStarred: false,
      starredAt: null,
    })
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
  const entries = [...merged.values()]

  const allRepoValues = entries.map((entry) => ({
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
  }))

  const allUserRepoValues = entries.map((entry) => ({
    userId,
    repoId: entry.repo.id,
    isOwned: entry.isOwned ? 1 : 0,
    isStarred: entry.isStarred ? 1 : 0,
    starredAt: entry.starredAt,
    syncedAt: now,
  }))

  await db.transaction(async (tx) => {
    await tx
      .update(userRepos)
      .set({ isOwned: 0, isStarred: 0, starredAt: null })
      .where(eq(userRepos.userId, userId))
      .run()

    for (let i = 0; i < allRepoValues.length; i += CHUNK_SIZE) {
      await tx
        .insert(repos)
        .values(allRepoValues.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: repos.id,
          set: {
            fullName: sql`excluded.full_name`,
            name: sql`excluded.name`,
            ownerLogin: sql`excluded.owner_login`,
            ownerAvatar: sql`excluded.owner_avatar`,
            description: sql`excluded.description`,
            htmlUrl: sql`excluded.html_url`,
            language: sql`excluded.language`,
            topics: sql`excluded.topics`,
            stargazersCount: sql`excluded.stargazers_count`,
            forksCount: sql`excluded.forks_count`,
            archived: sql`excluded.archived`,
            fork: sql`excluded.fork`,
            private: sql`excluded.private`,
            isTemplate: sql`excluded.is_template`,
            mirrorUrl: sql`excluded.mirror_url`,
            pushedAt: sql`excluded.pushed_at`,
            updatedAt: sql`excluded.updated_at`,
            createdAt: sql`excluded.created_at`,
          },
        })
        .run()
    }

    for (let i = 0; i < allUserRepoValues.length; i += CHUNK_SIZE) {
      await tx
        .insert(userRepos)
        .values(allUserRepoValues.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [userRepos.userId, userRepos.repoId],
          set: {
            isOwned: sql`excluded.is_owned`,
            isStarred: sql`excluded.is_starred`,
            starredAt: sql`excluded.starred_at`,
            syncedAt: sql`excluded.synced_at`,
          },
        })
        .run()
    }
  })

  return { ownedCount: input.owned.length, starredCount: input.starred.length }
}

export async function getLastSyncedAt(
  db: AppDatabase,
  userId: number,
): Promise<string | null> {
  const row = await db
    .select({ lastSyncedAt: sql<string | null>`MAX(${userRepos.syncedAt})` })
    .from(userRepos)
    .where(eq(userRepos.userId, userId))
    .get()
  return row!.lastSyncedAt
}
