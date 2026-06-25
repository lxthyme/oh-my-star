import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repos, userRepos, repoUserData, repoTags, tags } from "./schema"

export type RepoSource = "owned" | "starred"
export type RepoTypeFilter =
  | "all"
  | "sources"
  | "forks"
  | "archived"
  | "mirrors"
  | "templates"
export type RepoSort = "updated" | "name" | "stars" | "starred_at"
export type TriStateFilter = "all" | "favorite" | "not_favorite"
export type NoteFilterValue = "all" | "noted" | "not_noted"

export interface ListReposParams {
  source: RepoSource
  search?: string
  searchDescription?: boolean
  type?: RepoTypeFilter
  language?: string
  sort?: RepoSort
  favorite?: TriStateFilter
  note?: NoteFilterValue
  tagId?: number | "untagged"
  page?: number
  perPage?: number
}

export interface RepoListItem {
  id: number
  fullName: string
  name: string
  ownerLogin: string
  ownerAvatar: string | null
  description: string | null
  htmlUrl: string
  language: string | null
  topics: string[]
  stargazersCount: number
  forksCount: number
  archived: boolean
  fork: boolean
  private: boolean
  isTemplate: boolean
  pushedAt: string | null
  updatedAt: string | null
  isOwned: boolean
  isStarred: boolean
  starredAt: string | null
  isFavorite: boolean
  note: string | null
  tags: { id: number; name: string }[]
}

export interface ListReposResult {
  items: RepoListItem[]
  total: number
  page: number
  perPage: number
}

const DEFAULT_PER_PAGE = 30

function buildWhere(userId: number, params: ListReposParams): SQL | undefined {
  const conditions: SQL[] = [eq(userRepos.userId, userId)]

  conditions.push(
    params.source === "owned"
      ? eq(userRepos.isOwned, 1)
      : eq(userRepos.isStarred, 1),
  )

  if (params.search) {
    const term = `%${params.search}%`
    conditions.push(
      (params.searchDescription ?? true)
        ? sql`(${repos.name} LIKE ${term} OR ${repos.description} LIKE ${term})`
        : sql`${repos.name} LIKE ${term}`,
    )
  }

  if (params.type === "sources") {
    conditions.push(
      eq(repos.fork, 0),
      eq(repos.archived, 0),
      eq(repos.isTemplate, 0),
    )
  } else if (params.type === "forks") {
    conditions.push(eq(repos.fork, 1))
  } else if (params.type === "archived") {
    conditions.push(eq(repos.archived, 1))
  } else if (params.type === "mirrors") {
    conditions.push(sql`${repos.mirrorUrl} IS NOT NULL`)
  } else if (params.type === "templates") {
    conditions.push(eq(repos.isTemplate, 1))
  }

  if (params.language && params.language !== "all") {
    conditions.push(eq(repos.language, params.language))
  }

  if (params.favorite === "favorite") {
    conditions.push(eq(repoUserData.isFavorite, 1))
  } else if (params.favorite === "not_favorite") {
    conditions.push(sql`COALESCE(${repoUserData.isFavorite}, 0) = 0`)
  }

  if (params.note === "noted") {
    conditions.push(
      sql`(${repoUserData.note} IS NOT NULL AND ${repoUserData.note} != '')`,
    )
  } else if (params.note === "not_noted") {
    conditions.push(
      sql`(${repoUserData.note} IS NULL OR ${repoUserData.note} = '')`,
    )
  }

  if (params.tagId === "untagged") {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${repoTags} WHERE ${repoTags.repoId} = ${repos.id} AND ${repoTags.userId} = ${userId})`,
    )
  } else if (typeof params.tagId === "number") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${repoTags} WHERE ${repoTags.repoId} = ${repos.id} AND ${repoTags.tagId} = ${params.tagId} AND ${repoTags.userId} = ${userId})`,
    )
  }

  return and(...conditions)
}

export async function listRepos(
  db: AppDatabase,
  userId: number,
  params: ListReposParams,
): Promise<ListReposResult> {
  const page = params.page && params.page > 0 ? params.page : 1
  const perPage =
    params.perPage && params.perPage > 0 ? params.perPage : DEFAULT_PER_PAGE
  const where = buildWhere(userId, params)

  const sortColumnMap = {
    updated: repos.pushedAt,
    name: repos.name,
    stars: repos.stargazersCount,
    starred_at: userRepos.starredAt,
  } as const
  const sortColumn = sortColumnMap[params.sort ?? "updated"]
  const orderFn = params.sort === "name" ? asc : desc

  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(repos)
    .innerJoin(userRepos, eq(userRepos.repoId, repos.id))
    .leftJoin(
      repoUserData,
      and(
        eq(repoUserData.repoId, repos.id),
        eq(repoUserData.userId, userId),
      ),
    )
    .where(where)
    .get()
  const total = totalRow!.count

  const rows = await db
    .select({
      repo: repos,
      userRepo: userRepos,
      isFavorite: repoUserData.isFavorite,
      note: repoUserData.note,
    })
    .from(repos)
    .innerJoin(userRepos, eq(userRepos.repoId, repos.id))
    .leftJoin(
      repoUserData,
      and(
        eq(repoUserData.repoId, repos.id),
        eq(repoUserData.userId, userId),
      ),
    )
    .where(where)
    .orderBy(orderFn(sortColumn))
    .limit(perPage)
    .offset((page - 1) * perPage)
    .all()

  const repoIds = rows.map((row) => row.repo.id)
  const tagRows = repoIds.length
    ? await db
        .select({ repoId: repoTags.repoId, tagId: tags.id, tagName: tags.name })
        .from(repoTags)
        .innerJoin(tags, eq(tags.id, repoTags.tagId))
        .where(
          and(inArray(repoTags.repoId, repoIds), eq(repoTags.userId, userId)),
        )
        .all()
    : []

  const tagsByRepoId = new Map<number, { id: number; name: string }[]>()
  for (const row of tagRows) {
    const list = tagsByRepoId.get(row.repoId) ?? []
    list.push({ id: row.tagId, name: row.tagName })
    tagsByRepoId.set(row.repoId, list)
  }

  const items: RepoListItem[] = rows.map(
    ({ repo, userRepo, isFavorite, note }) => ({
      id: repo.id,
      fullName: repo.fullName,
      name: repo.name,
      ownerLogin: repo.ownerLogin,
      ownerAvatar: repo.ownerAvatar,
      description: repo.description,
      htmlUrl: repo.htmlUrl,
      language: repo.language,
      topics: JSON.parse(repo.topics) as string[],
      stargazersCount: repo.stargazersCount,
      forksCount: repo.forksCount,
      archived: repo.archived === 1,
      fork: repo.fork === 1,
      private: repo.private === 1,
      isTemplate: repo.isTemplate === 1,
      pushedAt: repo.pushedAt,
      updatedAt: repo.updatedAt,
      isOwned: userRepo.isOwned === 1,
      isStarred: userRepo.isStarred === 1,
      starredAt: userRepo.starredAt,
      isFavorite: isFavorite === 1,
      note,
      tags: tagsByRepoId.get(repo.id) ?? [],
    }),
  )

  return { items, total, page, perPage }
}

export async function listDistinctLanguages(
  db: AppDatabase,
  userId: number,
  source: RepoSource,
): Promise<string[]> {
  const sourceCondition =
    source === "owned" ? eq(userRepos.isOwned, 1) : eq(userRepos.isStarred, 1)
  const rows = await db
    .select({ language: repos.language })
    .from(repos)
    .innerJoin(userRepos, eq(userRepos.repoId, repos.id))
    .where(
      and(
        eq(userRepos.userId, userId),
        sourceCondition,
        sql`${repos.language} IS NOT NULL`,
      ),
    )
    .all()
  return [...new Set(rows.map((row) => row.language as string))].sort()
}

export interface RepoSourceCounts {
  owned: number
  starred: number
}

export async function countReposBySource(
  db: AppDatabase,
  userId: number,
): Promise<RepoSourceCounts> {
  const owned = await db
    .select({ count: sql<number>`count(*)` })
    .from(userRepos)
    .where(and(eq(userRepos.userId, userId), eq(userRepos.isOwned, 1)))
    .get()
  const starred = await db
    .select({ count: sql<number>`count(*)` })
    .from(userRepos)
    .where(and(eq(userRepos.userId, userId), eq(userRepos.isStarred, 1)))
    .get()
  return { owned: owned!.count, starred: starred!.count }
}

export async function setStarred(
  db: AppDatabase,
  userId: number,
  repoId: number,
  isStarred: boolean,
): Promise<void> {
  await db
    .update(userRepos)
    .set({
      isStarred: isStarred ? 1 : 0,
      starredAt: isStarred ? new Date().toISOString() : null,
    })
    .where(and(eq(userRepos.userId, userId), eq(userRepos.repoId, repoId)))
    .run()
}
