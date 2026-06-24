import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repos, repoUserData, repoTags, tags } from "./schema"

export type RepoSource = "owned" | "starred"
export type RepoTypeFilter = "all" | "sources" | "forks" | "archived" | "templates"
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

function buildWhere(params: ListReposParams): SQL | undefined {
  const conditions: SQL[] = []

  conditions.push(params.source === "owned" ? eq(repos.isOwned, 1) : eq(repos.isStarred, 1))

  if (params.search) {
    const term = `%${params.search}%`
    conditions.push(
      params.searchDescription ?? true
        ? sql`(${repos.name} LIKE ${term} OR ${repos.description} LIKE ${term})`
        : sql`${repos.name} LIKE ${term}`
    )
  }

  if (params.type === "sources") {
    conditions.push(eq(repos.fork, 0), eq(repos.archived, 0), eq(repos.isTemplate, 0))
  } else if (params.type === "forks") {
    conditions.push(eq(repos.fork, 1))
  } else if (params.type === "archived") {
    conditions.push(eq(repos.archived, 1))
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
    conditions.push(sql`(${repoUserData.note} IS NOT NULL AND ${repoUserData.note} != '')`)
  } else if (params.note === "not_noted") {
    conditions.push(sql`(${repoUserData.note} IS NULL OR ${repoUserData.note} = '')`)
  }

  if (params.tagId === "untagged") {
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM ${repoTags} WHERE ${repoTags.repoId} = ${repos.id})`)
  } else if (typeof params.tagId === "number") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${repoTags} WHERE ${repoTags.repoId} = ${repos.id} AND ${repoTags.tagId} = ${params.tagId})`
    )
  }

  return and(...conditions)
}

export function listRepos(db: AppDatabase, params: ListReposParams): ListReposResult {
  const page = params.page && params.page > 0 ? params.page : 1
  const perPage = params.perPage && params.perPage > 0 ? params.perPage : DEFAULT_PER_PAGE
  const where = buildWhere(params)

  const sortColumnMap = {
    updated: repos.pushedAt,
    name: repos.name,
    stars: repos.stargazersCount,
    starred_at: repos.starredAt,
  } as const
  const sortColumn = sortColumnMap[params.sort ?? "updated"]
  const orderFn = params.sort === "name" ? asc : desc

  const total = db
    .select({ count: sql<number>`count(*)` })
    .from(repos)
    .leftJoin(repoUserData, eq(repoUserData.repoId, repos.id))
    .where(where)
    .get()!.count

  const rows = db
    .select({ repo: repos, isFavorite: repoUserData.isFavorite, note: repoUserData.note })
    .from(repos)
    .leftJoin(repoUserData, eq(repoUserData.repoId, repos.id))
    .where(where)
    .orderBy(orderFn(sortColumn))
    .limit(perPage)
    .offset((page - 1) * perPage)
    .all()

  const repoIds = rows.map((row) => row.repo.id)
  const tagRows = repoIds.length
    ? db
        .select({ repoId: repoTags.repoId, tagId: tags.id, tagName: tags.name })
        .from(repoTags)
        .innerJoin(tags, eq(tags.id, repoTags.tagId))
        .where(inArray(repoTags.repoId, repoIds))
        .all()
    : []

  const tagsByRepoId = new Map<number, { id: number; name: string }[]>()
  for (const row of tagRows) {
    const list = tagsByRepoId.get(row.repoId) ?? []
    list.push({ id: row.tagId, name: row.tagName })
    tagsByRepoId.set(row.repoId, list)
  }

  const items: RepoListItem[] = rows.map(({ repo, isFavorite, note }) => ({
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
    isOwned: repo.isOwned === 1,
    isStarred: repo.isStarred === 1,
    starredAt: repo.starredAt,
    isFavorite: isFavorite === 1,
    note,
    tags: tagsByRepoId.get(repo.id) ?? [],
  }))

  return { items, total, page, perPage }
}

export function listDistinctLanguages(db: AppDatabase, source: RepoSource): string[] {
  const sourceCondition = source === "owned" ? eq(repos.isOwned, 1) : eq(repos.isStarred, 1)
  const rows = db
    .select({ language: repos.language })
    .from(repos)
    .where(and(sourceCondition, sql`${repos.language} IS NOT NULL`))
    .all()
  return [...new Set(rows.map((row) => row.language as string))].sort()
}

export function setStarred(db: AppDatabase, repoId: number, isStarred: boolean): void {
  db.update(repos)
    .set({ isStarred: isStarred ? 1 : 0, starredAt: isStarred ? new Date().toISOString() : null })
    .where(eq(repos.id, repoId))
    .run()
}
