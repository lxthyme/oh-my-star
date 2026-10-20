import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import {
  getLastGistSyncedAt,
  getLastSyncedAt,
  syncGists,
  syncRepos,
} from "@/lib/db/sync"
import {
  createGitHubClient,
  listOwnedGists,
  listOwnedRepos,
  listStarredGists,
  listStarredRepos,
} from "@/lib/github"
import { apiErrorResponse } from "@/lib/api-error"

/** 仓库与 gist 分开记录同步时间，取较新的那个作为「上次同步」 */
function latestTimestamp(values: (string | null)[]): string | null {
  const valid = values.filter((value): value is string => Boolean(value))
  if (valid.length === 0) return null
  return valid.reduce((latest, value) => (value > latest ? value : latest))
}

export async function GET() {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  try {
    const [repos, gists] = await Promise.all([
      getLastSyncedAt(db, session.userId),
      getLastGistSyncedAt(db, session.userId),
    ])
    return NextResponse.json({ lastSyncedAt: latestTimestamp([repos, gists]) })
  } catch (error) {
    return apiErrorResponse(error)
  }
}

export async function POST() {
  const session = await auth()
  if (!session?.accessToken || !session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const client = createGitHubClient(session.accessToken)

  try {
    const [ownedRepos, starredRepos, ownedGists, starredGists] =
      await Promise.all([
        listOwnedRepos(client),
        listStarredRepos(client),
        listOwnedGists(client),
        listStarredGists(client),
      ])
    const [repos, gists] = await Promise.all([
      syncRepos(db, session.userId, { owned: ownedRepos, starred: starredRepos }),
      syncGists(db, session.userId, { owned: ownedGists, starred: starredGists }),
    ])
    return NextResponse.json({
      ownedCount: repos.ownedCount,
      starredCount: repos.starredCount,
      gistOwnedCount: gists.ownedCount,
      gistStarredCount: gists.starredCount,
    })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401) {
      return NextResponse.json(
        { error: "GitHub 授权已失效，请重新登录: \(error?.msg)" },
        { status: 401 },
      )
    }
    if (status === 403) {
      return NextResponse.json(
        { error: "已达 GitHub API 限流，请稍后重试: \(error?.msg)" },
        { status: 429 },
      )
    }
    return apiErrorResponse(error, 502)
  }
}
