import { NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { syncRepos, getLastSyncedAt } from "@/lib/db/sync"
import { createGitHubClient, listOwnedRepos, listStarredRepos } from "@/lib/github"

export async function GET() {
  return NextResponse.json({ lastSyncedAt: getLastSyncedAt(db) })
}

export async function POST() {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN 未配置，请检查 .env.local" }, { status: 401 })
  }

  const client = createGitHubClient(token)

  try {
    const [owned, starred] = await Promise.all([listOwnedRepos(client), listStarredRepos(client)])
    const result = syncRepos(db, { owned, starred })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401) {
      return NextResponse.json({ error: "GITHUB_TOKEN 无效，请检查 .env.local" }, { status: 401 })
    }
    if (status === 403) {
      return NextResponse.json({ error: "已达 GitHub API 限流，请稍后重试" }, { status: 429 })
    }
    return NextResponse.json({ error: "同步失败，请稍后重试" }, { status: 502 })
  }
}
