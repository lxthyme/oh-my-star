import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import {
  TagHierarchyError,
  createTag,
  findTagByName,
  listTags,
  type TagScope,
} from "@/lib/db/tags"
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

  const sp = request.nextUrl.searchParams
  const source = sp.get("source")
  const tagSource = source === "owned" || source === "starred" ? source : undefined
  // 仓库标签与 gist 标签是两个命名空间，默认取仓库标签
  const scope: TagScope = sp.get("scope") === "gist" ? "gist" : "repo"

  try {
    return NextResponse.json({
      tags: await listTags(db, session.userId, tagSource, scope),
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

  // 不传 scope 时按仓库标签处理，与标签管理页的历史行为保持一致
  const scope: TagScope = body.scope === "gist" ? "gist" : "repo"

  let parentId: number | null = null
  if (body.parentId !== undefined && body.parentId !== null) {
    if (!Number.isInteger(body.parentId)) {
      return NextResponse.json(
        { error: "parentId 必须是数字" },
        { status: 400 },
      )
    }
    parentId = body.parentId
  }

  try {
    if (await findTagByName(db, session.userId, name, scope)) {
      return NextResponse.json(
        { error: `标签「${name}」已存在` },
        { status: 409 },
      )
    }
    const tag = await createTag(
      db,
      session.userId,
      name,
      rawDescription,
      parentId,
      scope,
    )
    return NextResponse.json(tag, { status: 201 })
  } catch (error) {
    if (error instanceof TagHierarchyError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return apiErrorResponse(error)
  }
}
