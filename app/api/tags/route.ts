import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { listTags, createTag } from "@/lib/db/tags"
import { apiErrorResponse } from "@/lib/api-error"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const source = request.nextUrl.searchParams.get("source")
  const repoSource = source === "owned" || source === "starred" ? source : undefined

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

  try {
    const tag = await createTag(db, session.userId, body.name.trim())
    return NextResponse.json(tag, { status: 201 })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
