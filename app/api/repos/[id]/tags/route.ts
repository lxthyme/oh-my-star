import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { getRepoTags, setRepoTags } from "@/lib/db/tags"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  return NextResponse.json({ tags: getRepoTags(db, repoId) })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  if (!Array.isArray(body.tagNames)) {
    return NextResponse.json(
      { error: "tagNames 必须是字符串数组" },
      { status: 400 },
    )
  }

  const tags = setRepoTags(db, repoId, body.tagNames)
  return NextResponse.json({ tags })
}
