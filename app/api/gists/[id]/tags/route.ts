import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { getGistTags, setGistTags } from "@/lib/db/gist-tags"
import { apiErrorResponse } from "@/lib/api-error"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  if (!id.trim()) {
    return NextResponse.json({ error: "id 不能为空" }, { status: 400 })
  }

  try {
    return NextResponse.json({
      tags: await getGistTags(db, session.userId, id),
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  if (!id.trim()) {
    return NextResponse.json({ error: "id 不能为空" }, { status: 400 })
  }

  const body = await request.json()
  if (!Array.isArray(body.tagIds)) {
    return NextResponse.json(
      { error: "tagIds 必须是数字数组" },
      { status: 400 },
    )
  }
  const tagIds = body.tagIds
    .map((id: unknown) => Number(id))
    .filter((id: number) => Number.isInteger(id))
  const rawNewTagNames = body.newTagNames
  if (rawNewTagNames !== undefined && !Array.isArray(rawNewTagNames)) {
    return NextResponse.json(
      { error: "newTagNames 必须是字符串数组" },
      { status: 400 },
    )
  }
  const newTagNames: string[] = Array.isArray(rawNewTagNames)
    ? rawNewTagNames.filter(
        (name: unknown): name is string => typeof name === "string",
      )
    : []

  try {
    const tags = await setGistTags(db, session.userId, id, tagIds, newTagNames)
    return NextResponse.json({ tags })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
