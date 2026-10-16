import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { createTag, findTagByName, listTags } from "@/lib/db/tags"
import { apiErrorResponse } from "@/lib/api-error"
import {
  TAG_DESCRIPTION_MAX_LENGTH,
  TAG_NAME_MAX_LENGTH,
} from "@/lib/tag-limits"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const source = request.nextUrl.searchParams.get("source")
  const repoSource =
    source === "owned" || source === "starred" ? source : undefined

  try {
    return NextResponse.json({
      tags: await listTags(db, session.userId, repoSource),
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const body = await request.json()
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 不能为空" }, { status: 400 })
  }
  const name = body.name.trim()
  if (name.length > TAG_NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: `name 不能超过 ${TAG_NAME_MAX_LENGTH} 个字符` },
      { status: 400 },
    )
  }

  const rawDescription =
    typeof body.description === "string" ? body.description.trim() : ""
  if (rawDescription.length > TAG_DESCRIPTION_MAX_LENGTH) {
    return NextResponse.json(
      { error: `description 不能超过 ${TAG_DESCRIPTION_MAX_LENGTH} 个字符` },
      { status: 400 },
    )
  }

  try {
    if (await findTagByName(db, session.userId, name)) {
      return NextResponse.json(
        { error: `标签「${name}」已存在` },
        { status: 409 },
      )
    }
    const tag = await createTag(db, session.userId, name, rawDescription)
    return NextResponse.json(tag, { status: 201 })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
