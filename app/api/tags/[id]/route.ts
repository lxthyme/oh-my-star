import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import {
  deleteTag,
  findTagByName,
  updateTag,
  type TagUpdateInput,
} from "@/lib/db/tags"
import { apiErrorResponse } from "@/lib/api-error"
import {
  TAG_DESCRIPTION_MAX_LENGTH,
  TAG_NAME_MAX_LENGTH,
} from "@/lib/tag-limits"

type RouteContext = { params: Promise<{ id: string }> }

/** 解析出当前用户的 tagId，返回 null 表示参数非法 */
function parseTagId(id: string): number | null {
  const tagId = Number(id)
  return Number.isInteger(tagId) ? tagId : null
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  const tagId = parseTagId(id)
  if (tagId === null) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  const input: TagUpdateInput = {}

  if (body.name !== undefined) {
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
    input.name = name
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      return NextResponse.json(
        { error: "description 必须是字符串或 null" },
        { status: 400 },
      )
    }
    const description =
      typeof body.description === "string" ? body.description.trim() : ""
    if (description.length > TAG_DESCRIPTION_MAX_LENGTH) {
      return NextResponse.json(
        { error: `description 不能超过 ${TAG_DESCRIPTION_MAX_LENGTH} 个字符` },
        { status: 400 },
      )
    }
    input.description = description
  }

  if (input.name === undefined && input.description === undefined) {
    return NextResponse.json({ error: "没有需要更新的字段" }, { status: 400 })
  }

  try {
    if (input.name !== undefined) {
      const conflict = await findTagByName(db, session.userId, input.name)
      if (conflict && conflict.id !== tagId) {
        return NextResponse.json(
          { error: `标签「${input.name}」已存在` },
          { status: 409 },
        )
      }
    }

    const updated = await updateTag(db, session.userId, tagId, input)
    if (!updated) {
      return NextResponse.json({ error: "标签不存在" }, { status: 404 })
    }
    return NextResponse.json(updated)
  } catch (error) {
    return apiErrorResponse(error)
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  const tagId = parseTagId(id)
  if (tagId === null) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  try {
    const deleted = await deleteTag(db, session.userId, tagId)
    if (!deleted) {
      return NextResponse.json({ error: "标签不存在" }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
