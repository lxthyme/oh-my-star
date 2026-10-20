import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { gists, gistTags, gistUserData, tags, userGists } from "./schema"
import { listTagSubtreeIds } from "./tags"
import type { NoteFilterValue, TriStateFilter } from "./repos"

export type GistSource = "owned" | "starred"
/** GitHub 上 gist 只有公开/私密两种可见性 */
export type GistTypeFilter = "all" | "public" | "secret"
export type GistSort =
  | "created"
  | "created_asc"
  | "updated"
  | "updated_asc"
  | "stars"

export interface GistFile {
  name: string
  language: string | null
  size: number
  /** 截断后的文件内容预览，用于卡片里直接看代码片段 */
  preview: string
}

export interface ListGistsParams {
  source: GistSource
  search?: string
  type?: GistTypeFilter
  sort?: GistSort
  favorite?: TriStateFilter
  note?: NoteFilterValue
  tagId?: number | "untagged"
  page?: number
  perPage?: number
}

export interface GistListItem {
  id: string
  description: string | null
  htmlUrl: string
  ownerLogin: string
  ownerAvatar: string | null
  public: boolean
  commentsCount: number
  forksCount: number
  stargazersCount: number
  files: GistFile[]
  createdAt: string | null
  updatedAt: string | null
  isOwned: boolean
  isStarred: boolean
  isFavorite: boolean
  note: string | null
  tags: { id: number; name: string }[]
}

export interface ListGistsResult {
  items: GistListItem[]
  total: number
  page: number
  perPage: number
}

const DEFAULT_PER_PAGE = 30

export function parseGistFiles(raw: string): GistFile[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as GistFile[]) : []
  } catch {
    return []
  }
}

function buildWhere(
  userId: number,
  params: ListGistsParams,
  /** 选中标签的子树 id 集合（含自身），命中父标签时匹配整棵子树 */
  tagIds?: number[],
): SQL | undefined {
  const conditions: SQL[] = [eq(userGists.userId, userId)]

  conditions.push(
    params.source === "owned"
      ? eq(userGists.isOwned, 1)
      : eq(userGists.isStarred, 1),
  )

  // gist 没有名称，搜索走描述 + 文件名/内容（都包含在 files 这个 JSON 列里）
  if (params.search) {
    const term = `%${params.search}%`
    conditions.push(
      sql`(${gists.description} LIKE ${term} OR ${gists.files} LIKE ${term})`,
    )
  }

  if (params.type === "public") {
    conditions.push(eq(gists.public, 1))
  } else if (params.type === "secret") {
    conditions.push(eq(gists.public, 0))
  }

  if (params.favorite === "favorite") {
    conditions.push(eq(gistUserData.isFavorite, 1))
  } else if (params.favorite === "not_favorite") {
    conditions.push(sql`COALESCE(${gistUserData.isFavorite}, 0) = 0`)
  }

  if (params.note === "noted") {
    conditions.push(
      sql`(${gistUserData.note} IS NOT NULL AND ${gistUserData.note} != '')`,
    )
  } else if (params.note === "not_noted") {
    conditions.push(
      sql`(${gistUserData.note} IS NULL OR ${gistUserData.note} = '')`,
    )
  }

  if (params.tagId === "untagged") {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${gistTags} WHERE ${gistTags.gistId} = ${gists.id} AND ${gistTags.userId} = ${userId})`,
    )
  } else if (typeof params.tagId === "number") {
    const ids = tagIds?.length ? tagIds : [params.tagId]
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${gistTags} WHERE ${gistTags.gistId} = ${gists.id} AND ${gistTags.userId} = ${userId} AND ${inArray(gistTags.tagId, ids)})`,
    )
  }

  return and(...conditions)
}

function orderByFor(sort: GistSort | undefined) {
  switch (sort) {
    case "created":
      return desc(gists.createdAt)
    case "created_asc":
      return asc(gists.createdAt)
    case "updated":
      return desc(gists.updatedAt)
    case "updated_asc":
      return asc(gists.updatedAt)
    case "stars":
      return desc(gists.stargazersCount)
    default:
      return desc(gists.createdAt)
  }
}

export async function listGists(
  db: AppDatabase,
  userId: number,
  params: ListGistsParams,
): Promise<ListGistsResult> {
  const page = params.page && params.page > 0 ? params.page : 1
  const perPage =
    params.perPage && params.perPage > 0 ? params.perPage : DEFAULT_PER_PAGE
  // 选中父标签时按整棵子树匹配
  const tagIds =
    typeof params.tagId === "number"
      ? await listTagSubtreeIds(db, userId, params.tagId)
      : undefined
  const where = buildWhere(userId, params, tagIds)

  // 排序后仍按 id 兜底，避免创建时间相同的 gist 在翻页时错位
  const orderBy = [orderByFor(params.sort), desc(gists.id)]

  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(gists)
    .innerJoin(userGists, eq(userGists.gistId, gists.id))
    .leftJoin(
      gistUserData,
      and(eq(gistUserData.gistId, gists.id), eq(gistUserData.userId, userId)),
    )
    .where(where)
    .get()
  const total = totalRow!.count

  const rows = await db
    .select({
      gist: gists,
      userGist: userGists,
      isFavorite: gistUserData.isFavorite,
      note: gistUserData.note,
    })
    .from(gists)
    .innerJoin(userGists, eq(userGists.gistId, gists.id))
    .leftJoin(
      gistUserData,
      and(eq(gistUserData.gistId, gists.id), eq(gistUserData.userId, userId)),
    )
    .where(where)
    .orderBy(...orderBy)
    .limit(perPage)
    .offset((page - 1) * perPage)
    .all()

  const gistIds = rows.map((row) => row.gist.id)
  const tagRows = gistIds.length
    ? await db
        .select({ gistId: gistTags.gistId, tagId: tags.id, tagName: tags.name })
        .from(gistTags)
        .innerJoin(tags, eq(tags.id, gistTags.tagId))
        .where(
          and(inArray(gistTags.gistId, gistIds), eq(gistTags.userId, userId)),
        )
        .all()
    : []

  const tagsByGistId = new Map<string, { id: number; name: string }[]>()
  for (const row of tagRows) {
    const list = tagsByGistId.get(row.gistId) ?? []
    list.push({ id: row.tagId, name: row.tagName })
    tagsByGistId.set(row.gistId, list)
  }

  const items: GistListItem[] = rows.map(
    ({ gist, userGist, isFavorite, note }) => ({
      id: gist.id,
      description: gist.description,
      htmlUrl: gist.htmlUrl,
      ownerLogin: gist.ownerLogin,
      ownerAvatar: gist.ownerAvatar,
      public: gist.public === 1,
      commentsCount: gist.commentsCount,
      forksCount: gist.forksCount,
      stargazersCount: gist.stargazersCount,
      files: parseGistFiles(gist.files),
      createdAt: gist.createdAt,
      updatedAt: gist.updatedAt,
      isOwned: userGist.isOwned === 1,
      isStarred: userGist.isStarred === 1,
      isFavorite: isFavorite === 1,
      note,
      tags: tagsByGistId.get(gist.id) ?? [],
    }),
  )

  return { items, total, page, perPage }
}

export interface GistSourceCounts {
  owned: number
  starred: number
}

export async function countGistsBySource(
  db: AppDatabase,
  userId: number,
): Promise<GistSourceCounts> {
  const owned = await db
    .select({ count: sql<number>`count(*)` })
    .from(userGists)
    .where(and(eq(userGists.userId, userId), eq(userGists.isOwned, 1)))
    .get()
  const starred = await db
    .select({ count: sql<number>`count(*)` })
    .from(userGists)
    .where(and(eq(userGists.userId, userId), eq(userGists.isStarred, 1)))
    .get()
  return { owned: owned!.count, starred: starred!.count }
}

export async function setGistStarred(
  db: AppDatabase,
  userId: number,
  gistId: string,
  isStarred: boolean,
): Promise<void> {
  await db
    .update(userGists)
    .set({
      isStarred: isStarred ? 1 : 0,
      starredAt: isStarred ? new Date().toISOString() : null,
    })
    .where(and(eq(userGists.userId, userId), eq(userGists.gistId, gistId)))
    .run()
}
