import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { syncRepos, getLastSyncedAt } from "@/lib/db/sync"
import {
  createGitHubClient,
  listOwnedRepos,
  listStarredRepos,
} from "@/lib/github"

export async function GET() {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  return NextResponse.json({
    lastSyncedAt: await getLastSyncedAt(db, session.userId),
  })
}

export async function POST() {
  const session = await auth()
  if (!session?.accessToken || !session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const client = createGitHubClient(session.accessToken)

  try {
    const [owned, starred] = await Promise.all([
      listOwnedRepos(client),
      listStarredRepos(client),
    ])
    const result = await syncRepos(db, session.userId, { owned, starred })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401) {
      return NextResponse.json(
        { error: "GitHub 授权已失效，请重新登录" },
        { status: 401 },
      )
    }
    if (status === 403) {
      return NextResponse.json(
        { error: "已达 GitHub API 限流，请稍后重试" },
        { status: 429 },
      )
    }
    return NextResponse.json({ error: "同步失败，请稍后重试" }, { status: 502 })
  }
}
