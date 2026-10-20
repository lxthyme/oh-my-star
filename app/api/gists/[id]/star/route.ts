import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { setGistStarred } from "@/lib/db/gists"
import { createGitHubClient, starGist, unstarGist } from "@/lib/github"
import { apiErrorResponse } from "@/lib/api-error"

/** gist id 是字符串，只做非空校验，不能像 repo 那样 Number() 解析 */
function parseGistId(id: string): string | null {
  const gistId = id.trim()
  return gistId.length > 0 ? gistId : null
}

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const gistId = parseGistId(id)
  if (!gistId) {
    return NextResponse.json({ error: "id 不能为空" }, { status: 400 })
  }

  const session = await auth()
  if (!session?.accessToken || !session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  try {
    await starGist(createGitHubClient(session.accessToken), gistId)
    await setGistStarred(db, session.userId, gistId, true)
    return NextResponse.json({ id: gistId, isStarred: true })
  } catch (error) {
    return apiErrorResponse(error, 502)
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const gistId = parseGistId(id)
  if (!gistId) {
    return NextResponse.json({ error: "id 不能为空" }, { status: 400 })
  }

  const session = await auth()
  if (!session?.accessToken || !session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  try {
    await unstarGist(createGitHubClient(session.accessToken), gistId)
    await setGistStarred(db, session.userId, gistId, false)
    return NextResponse.json({ id: gistId, isStarred: false })
  } catch (error) {
    return apiErrorResponse(error, 502)
  }
}
