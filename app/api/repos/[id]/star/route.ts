import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { repos } from "@/lib/db/schema"
import { setStarred } from "@/lib/db/repos"
import { createGitHubClient, starRepo, unstarRepo } from "@/lib/github"
import { apiErrorResponse } from "@/lib/api-error"

async function getOwnerAndName(
  repoId: number,
): Promise<{ owner: string; name: string } | null> {
  const row = await db
    .select({ fullName: repos.fullName })
    .from(repos)
    .where(eq(repos.id, repoId))
    .get()
  if (!row) return null
  const [owner, name] = row.fullName.split("/")
  return { owner, name }
}

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const session = await auth()
  if (!session?.accessToken || !session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  try {
    const target = await getOwnerAndName(repoId)
    if (!target) {
      return NextResponse.json({ error: "仓库不存在" }, { status: 404 })
    }
    await starRepo(
      createGitHubClient(session.accessToken),
      target.owner,
      target.name,
    )
    await setStarred(db, session.userId, repoId, true)
    return NextResponse.json({ id: repoId, isStarred: true })
  } catch (error) {
    return apiErrorResponse(error, 502)
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const session = await auth()
  if (!session?.accessToken || !session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  try {
    const target = await getOwnerAndName(repoId)
    if (!target) {
      return NextResponse.json({ error: "仓库不存在" }, { status: 404 })
    }
    await unstarRepo(
      createGitHubClient(session.accessToken),
      target.owner,
      target.name,
    )
    await setStarred(db, session.userId, repoId, false)
    return NextResponse.json({ id: repoId, isStarred: false })
  } catch (error) {
    return apiErrorResponse(error, 502)
  }
}
